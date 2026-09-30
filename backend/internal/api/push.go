package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/slbirdwatch/backend/internal/config"
)

// NTF-01 push through Expo's push service (free, no key; FCM on Android and APNs on iOS are configured in EAS).
// Notifications are created in the database first (in-app inbox); pushUser then sends the ones not pushed yet.

var pushURL = config.Env("EXPO_PUSH_URL", "https://exp.host/--/api/v2/push/send") // overridden in tests

// POST /me/push-token {token, platform} — this device receives pushes for the signed-in person.
func (a *Server) savePushToken(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token    string `json:"token"`
		Platform string `json:"platform"`
		Device   string `json:"device"` // e.g. "Pixel 7", shown in the device list
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&body); err != nil ||
		!strings.HasPrefix(body.Token, "ExponentPushToken[") || len(body.Token) > 200 || len(body.Platform) > 20 || len(body.Device) > 80 {
		writeError(w, http.StatusBadRequest, "token must be an Expo push token")
		return
	}
	// A phone that changes hands moves its token to the new person.
	if _, err := a.db.Exec(r.Context(), `INSERT INTO push_tokens (token, user_id, platform, device_name) VALUES ($1, $2, $3, $4)
		ON CONFLICT (token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, device_name = excluded.device_name,
			updated_at = now()`,
		body.Token, userID(r), body.Platform, body.Device); err != nil {
		internalError(w, "save push token", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DELETE /me/push-token?token= — on sign-out, so the next person on this phone doesn't get these pushes.
func (a *Server) deletePushToken(w http.ResponseWriter, r *http.Request) {
	if _, err := a.db.Exec(r.Context(), `DELETE FROM push_tokens WHERE token = $1 AND user_id = $2`,
		r.URL.Query().Get("token"), userID(r)); err != nil {
		internalError(w, "delete push token", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type pushMessage struct {
	To        string         `json:"to"`
	Title     string         `json:"title"`
	Body      string         `json:"body"`
	Data      map[string]any `json:"data"`
	Sound     string         `json:"sound"`
	ChannelID string         `json:"channelId"`
}

// pushText mirrors the in-app wording.
func pushText(kind, actor, species, status string) (title, body string) {
	if species == "" {
		species = "a bird"
	}
	switch {
	case kind == "comment":
		return "New comment", actor + " commented on your sighting"
	case kind == "reply":
		return "New reply", actor + " replied to your comment"
	case kind == "rare":
		return "Rare bird nearby", species + " was just verified within your alert area"
	case kind == "identification":
		return "New ID on your sighting", actor + " identified your sighting as " + species
	case status == "verified":
		return "Sighting verified", "A verifier confirmed your " + species
	default:
		return "Community ID", "The community agreed your sighting is a " + species
	}
}

// pushUser sends this person's not-yet-pushed notifications to their devices, then marks them pushed.
// Runs after the request's transaction commits; failures are logged (the inbox still has everything).
func (a *Server) pushUser(userID int64) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := a.sendPushes(ctx, userID); err != nil {
		log.Printf("push to user %d: %v", userID, err)
	}
}

func (a *Server) sendPushes(ctx context.Context, userID int64) error {
	rows, err := a.db.Query(ctx, `SELECT token FROM push_tokens WHERE user_id = $1`, userID)
	if err != nil {
		return err
	}
	tokens, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil || len(tokens) == 0 {
		return err // no phones registered: the inbox is enough
	}
	type pending struct {
		id, observation              int64
		kind, actor, species, status string
	}
	rows, err = a.db.Query(ctx, `
		UPDATE notifications n SET pushed_at = now()
		FROM notifications x LEFT JOIN users u ON u.id = x.actor_id LEFT JOIN species s ON s.id = x.species_id
		WHERE n.id = x.id AND n.user_id = $1 AND n.pushed_at IS NULL AND n.created_at > now() - interval '1 hour'
		RETURNING n.id, n.observation_id, n.kind, coalesce(u.display_name, 'Someone'), coalesce(s.english_name, ''), n.status`, userID)
	if err != nil {
		return err
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (pending, error) {
		var p pending
		return p, row.Scan(&p.id, &p.observation, &p.kind, &p.actor, &p.species, &p.status)
	})
	if err != nil || len(items) == 0 {
		return err
	}
	var msgs []pushMessage
	for _, p := range items {
		title, body := pushText(p.kind, p.actor, p.species, p.status)
		for _, t := range tokens {
			msgs = append(msgs, pushMessage{To: t, Title: title, Body: body, Sound: "default", ChannelID: "default",
				Data: map[string]any{"observation_id": p.observation, "notification_id": p.id}})
		}
	}
	return a.postPushes(ctx, msgs)
}

// postPushes sends up to 100 messages per request (Expo's limit) and forgets tokens Expo says are dead.
func (a *Server) postPushes(ctx context.Context, msgs []pushMessage) error {
	for start := 0; start < len(msgs); start += 100 {
		batch := msgs[start:min(start+100, len(msgs))]
		b, _ := json.Marshal(batch)
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, pushURL, bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return err
		}
		var out struct {
			Data []struct {
				Status  string `json:"status"`
				Message string `json:"message"`
				Details struct {
					Error string `json:"error"`
				} `json:"details"`
			} `json:"data"`
		}
		err = json.NewDecoder(resp.Body).Decode(&out)
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("expo push: %s", resp.Status)
		}
		if err != nil {
			return fmt.Errorf("expo push: %w", err)
		}
		for i, ticket := range out.Data {
			if ticket.Status == "error" && ticket.Details.Error == "DeviceNotRegistered" && i < len(batch) {
				if _, err := a.db.Exec(ctx, `DELETE FROM push_tokens WHERE token = $1`, batch[i].To); err != nil {
					log.Printf("drop unregistered push token: %v", err)
				}
			} else if ticket.Status == "error" {
				log.Printf("expo push ticket: %s %s", ticket.Details.Error, ticket.Message)
			}
		}
	}
	return nil
}

// GET /me/devices — the phones this account gets push notifications on (each sign-in on a phone adds it).
func (a *Server) myDevices(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.Query(r.Context(), `SELECT token, platform, device_name, created_at, updated_at FROM push_tokens
		WHERE user_id = $1 ORDER BY updated_at DESC`, userID(r))
	if err != nil {
		internalError(w, "devices", err)
		return
	}
	type device struct {
		Token    string    `json:"token"`
		Platform string    `json:"platform"`
		Name     string    `json:"name"`
		Added    time.Time `json:"added_at"`
		LastSeen time.Time `json:"last_seen_at"`
	}
	items, err := pgx.CollectRows(rows, pgx.RowToStructByPos[device])
	if err != nil {
		internalError(w, "devices", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}
