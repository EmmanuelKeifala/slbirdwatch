package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

// NTF-01/04: in-app notifications for the observer when someone identifies their sighting, and when it reaches
// Community ID or Verified; each kind can be switched off in the profile (notify_ids, notify_status).
// ponytail: in-app only; push (Expo) can send the same rows once the app has an EAS project and dev build.

// notifyIdentification runs inside the identification's transaction, after consensus was recomputed.
func notifyIdentification(ctx context.Context, tx pgx.Tx, oid, owner, actor, speciesID int64, before string) error {
	if _, err := tx.Exec(ctx, `INSERT INTO notifications (user_id, kind, observation_id, actor_id, species_id)
		SELECT $1, 'identification', $2, $3, $4 FROM users WHERE id = $1 AND notify_ids`, owner, oid, actor, speciesID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `INSERT INTO notifications (user_id, kind, observation_id, species_id, status)
		SELECT $1, 'status', o.id, o.community_species_id, o.status FROM observations o JOIN users u ON u.id = $1
		WHERE o.id = $2 AND u.notify_status AND o.status IN ('community', 'verified') AND o.status <> $3`, owner, oid, before)
	return err
}

type notification struct {
	ID          int64       `json:"id"`
	Kind        string      `json:"kind"` // identification | status
	Observation int64       `json:"observation_id"`
	Actor       *observer   `json:"actor"`
	Species     *speciesRef `json:"species"`
	Status      string      `json:"status"`
	Read        bool        `json:"read"`
	CreatedAt   time.Time   `json:"created_at"`
}

// GET /me/notifications?offset= — newest first, 30 a page, with the unread count.
func (a *Server) myNotifications(w http.ResponseWriter, r *http.Request) {
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	rows, err := a.db.Query(r.Context(), `
		SELECT n.id, n.kind, n.observation_id, u.id, u.display_name, u.avatar_key, s.id, s.english_name, s.scientific_name,
		       n.status, n.read_at IS NOT NULL, n.created_at
		FROM notifications n
		LEFT JOIN users u ON u.id = n.actor_id
		LEFT JOIN species s ON s.id = n.species_id
		WHERE n.user_id = $1 ORDER BY n.created_at DESC, n.id DESC LIMIT 31 OFFSET $2`, userID(r), max(offset, 0))
	if err != nil {
		internalError(w, "notifications", err)
		return
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (notification, error) {
		var n notification
		var uid, sid *int64
		var uname, avatar, en, sci *string
		err := row.Scan(&n.ID, &n.Kind, &n.Observation, &uid, &uname, &avatar, &sid, &en, &sci, &n.Status, &n.Read, &n.CreatedAt)
		if uid != nil {
			n.Actor = &observer{ID: *uid, DisplayName: *uname, AvatarURL: a.mediaURL(avatar)}
		}
		if sid != nil {
			n.Species = &speciesRef{ID: *sid, EnglishName: *en, ScientificName: *sci}
		}
		return n, err
	})
	if err != nil {
		internalError(w, "notifications", err)
		return
	}
	var unread int
	if err := a.db.QueryRow(r.Context(), `SELECT count(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL`, userID(r)).Scan(&unread); err != nil {
		internalError(w, "notifications", err)
		return
	}
	var next any
	if len(items) > 30 {
		items, next = items[:30], offset+30
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "unread": unread, "next_offset": next})
}

// POST /me/notifications/read {ids} — marks those read, or all of them when ids is empty.
func (a *Server) readNotifications(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs []int64 `json:"ids"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	if _, err := a.db.Exec(r.Context(), `UPDATE notifications SET read_at = now()
		WHERE user_id = $1 AND read_at IS NULL AND (coalesce(cardinality($2::bigint[]), 0) = 0 OR id = ANY($2))`, userID(r), body.IDs); err != nil {
		internalError(w, "read notifications", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DELETE /me/notifications/{id} — remove one; DELETE /me/notifications — clear them all.
func (a *Server) deleteNotifications(w http.ResponseWriter, r *http.Request) {
	var err error
	if idStr := r.PathValue("id"); idStr != "" {
		id, perr := strconv.ParseInt(idStr, 10, 64)
		if perr != nil {
			http.NotFound(w, r)
			return
		}
		_, err = a.db.Exec(r.Context(), `DELETE FROM notifications WHERE id = $1 AND user_id = $2`, id, userID(r))
	} else {
		_, err = a.db.Exec(r.Context(), `DELETE FROM notifications WHERE user_id = $1`, userID(r))
	}
	if err != nil {
		internalError(w, "delete notifications", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
