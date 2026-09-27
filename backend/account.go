package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

// DELETE /me — ACC-07. Needs the password (or "confirm": "DELETE" for accounts without one).
// User-owned rows go with the user via ON DELETE CASCADE (observations); media objects are removed here.
// ponytail: each new user-owned table must decide cascade vs anonymise.
func (a *server) deleteAccount(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Password string `json:"password"`
		Confirm  string `json:"confirm"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	id := userID(r)
	if a.rateLimited(r.Context(), "delete:"+strconv.FormatInt(id, 10), 5, 15*time.Minute) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "too many attempts, try again in 15 minutes"})
		return
	}

	var hash, avatarKey *string
	err := a.db.QueryRow(r.Context(), `SELECT password_hash, avatar_key FROM users WHERE id = $1`, id).Scan(&hash, &avatarKey)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "account no longer exists"})
		return
	}
	if err != nil {
		internalError(w, "delete lookup", err)
		return
	}
	if hash != nil && bcrypt.CompareHashAndPassword([]byte(*hash), []byte(body.Password)) != nil {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "wrong password"})
		return
	}
	if hash == nil && body.Confirm != "DELETE" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": `send "confirm": "DELETE" to delete this account`})
		return
	}

	keys, err := a.userMediaKeys(r.Context(), id)
	if err != nil {
		internalError(w, "list media", err)
		return
	}
	// Their identifications vanish with them, so re-run consensus on the observations they identified.
	err = pgx.BeginFunc(r.Context(), a.db, func(tx pgx.Tx) error {
		rows, err := tx.Query(r.Context(), `SELECT DISTINCT i.observation_id FROM identifications i
			JOIN observations o ON o.id = i.observation_id WHERE i.user_id = $1 AND i.is_current AND o.user_id <> $1`, id)
		if err != nil {
			return err
		}
		affected, err := pgx.CollectRows(rows, pgx.RowTo[int64])
		if err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `DELETE FROM users WHERE id = $1`, id); err != nil {
			return err
		}
		for _, oid := range affected {
			if err := recompute(r.Context(), tx, oid); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		internalError(w, "delete user", err)
		return
	}
	if avatarKey != nil {
		keys = append(keys, *avatarKey)
	}
	for _, k := range keys {
		a.media.remove(r.Context(), k)
	}
	if err := a.revokeAllSessions(r.Context(), id); err != nil {
		// The row is gone, so requireUser-protected handlers already reject these sessions via "account no longer exists".
		internalError(w, "revoke sessions", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GET /me/export — ACC-07. Everything we hold about the user, as JSON.
// ponytail: add each new user-owned table (observations, quiz attempts, ...) here as it lands.
func (a *server) exportAccount(w http.ResponseWriter, r *http.Request) {
	u, err := a.loadUser(r.Context(), userID(r))
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "account no longer exists"})
		return
	}
	if err != nil {
		internalError(w, "export", err)
		return
	}
	rows, err := a.db.Query(r.Context(), observationSelect+` WHERE o.user_id = $1 ORDER BY o.observed_at`, u.ID)
	if err != nil {
		internalError(w, "export observations", err)
		return
	}
	obs, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (observation, error) { return a.scanObservation(row) })
	if err == nil {
		err = a.withPhotos(r.Context(), obs)
	}
	if err != nil {
		internalError(w, "export observations", err)
		return
	}
	type edit struct {
		ObservationID int64          `json:"observation_id"`
		EditedAt      time.Time      `json:"edited_at"`
		Changes       map[string]any `json:"changes"`
	}
	rows, err = a.db.Query(r.Context(), `
		SELECT e.observation_id, e.edited_at, e.changes FROM observation_edits e
		JOIN observations o ON o.id = e.observation_id WHERE o.user_id = $1 ORDER BY e.edited_at`, u.ID)
	if err != nil {
		internalError(w, "export edits", err)
		return
	}
	edits, err := pgx.CollectRows(rows, pgx.RowToStructByPos[edit])
	if err != nil {
		internalError(w, "export edits", err)
		return
	}
	type myID struct {
		ObservationID int64     `json:"observation_id"`
		SpeciesID     int64     `json:"species_id"`
		Reason        string    `json:"reason"`
		Current       bool      `json:"current"`
		CreatedAt     time.Time `json:"created_at"`
	}
	rows, err = a.db.Query(r.Context(), `SELECT observation_id, species_id, reason, is_current, created_at
		FROM identifications WHERE user_id = $1 ORDER BY created_at`, u.ID)
	if err != nil {
		internalError(w, "export identifications", err)
		return
	}
	ids, err := pgx.CollectRows(rows, pgx.RowToStructByPos[myID])
	if err != nil {
		internalError(w, "export identifications", err)
		return
	}
	type myFlag struct {
		ObservationID int64     `json:"observation_id"`
		Reason        string    `json:"reason"`
		Note          string    `json:"note"`
		Status        string    `json:"status"`
		CreatedAt     time.Time `json:"created_at"`
	}
	rows, err = a.db.Query(r.Context(), `SELECT observation_id, reason::text, note, status, created_at
		FROM flags WHERE user_id = $1 ORDER BY created_at`, u.ID)
	if err != nil {
		internalError(w, "export flags", err)
		return
	}
	myFlags, err := pgx.CollectRows(rows, pgx.RowToStructByPos[myFlag])
	if err != nil {
		internalError(w, "export flags", err)
		return
	}
	var blocked []int64
	var reported []map[string]any
	rows, err = a.db.Query(r.Context(), `SELECT blocked_id FROM blocks WHERE blocker_id = $1`, u.ID)
	if err == nil {
		blocked, err = pgx.CollectRows(rows, pgx.RowTo[int64])
	}
	if err == nil {
		rows, err = a.db.Query(r.Context(), `SELECT reported_id, reason::text, note, created_at FROM user_reports WHERE reporter_id = $1`, u.ID)
	}
	if err == nil {
		reported, err = pgx.CollectRows(rows, pgx.RowToMap)
	}
	var modActions []map[string]any // ADM-01: actions moderators took on this account (who took them is not shared)
	if err == nil {
		rows, err = a.db.Query(r.Context(), `SELECT action, note, created_at FROM moderation_actions
			WHERE target_type = 'user' AND target_id = $1 ORDER BY created_at`, u.ID)
	}
	if err == nil {
		modActions, err = pgx.CollectRows(rows, pgx.RowToMap)
	}
	var notes []map[string]any // NTF-01
	if err == nil {
		rows, err = a.db.Query(r.Context(), `SELECT kind, observation_id, species_id, status, read_at, created_at
			FROM notifications WHERE user_id = $1 ORDER BY created_at`, u.ID)
	}
	if err == nil {
		notes, err = pgx.CollectRows(rows, pgx.RowToMap)
	}
	var quiz []map[string]any // ACC-04
	if err == nil {
		rows, err = a.db.Query(r.Context(), `SELECT quizzes, answered, correct, best_streak, missed FROM quiz_stats WHERE user_id = $1`, u.ID)
	}
	if err == nil {
		quiz, err = pgx.CollectRows(rows, pgx.RowToMap)
	}
	var outs []map[string]any // OBS-10
	if err == nil {
		rows, err = a.db.Query(r.Context(), `SELECT id, started_at, ended_at, ST_AsGeoJSON(route) AS route FROM outings WHERE user_id = $1 ORDER BY started_at`, u.ID)
	}
	if err == nil {
		outs, err = pgx.CollectRows(rows, pgx.RowToMap)
	}
	var coms []map[string]any // VER-09
	if err == nil {
		rows, err = a.db.Query(r.Context(), `SELECT id, observation_id, parent_id, body, deleted, created_at FROM comments WHERE user_id = $1 ORDER BY created_at`, u.ID)
	}
	if err == nil {
		coms, err = pgx.CollectRows(rows, pgx.RowToMap)
	}
	if err != nil {
		internalError(w, "export blocks", err)
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="slbirdwatch-export.json"`)
	writeJSON(w, http.StatusOK, map[string]any{
		"exported_at":       time.Now().UTC(),
		"user":              u,
		"observations":      obs,
		"observation_edits": edits,
		"identifications":   ids,
		"flags":             myFlags,
		"blocked_users":     blocked,
		"user_reports":      reported,
		"moderation":        modActions,
		"notifications":     notes,
		"quiz_progress":     quiz,
		"outings":           outs,
		"comments":          coms,
	})
}
