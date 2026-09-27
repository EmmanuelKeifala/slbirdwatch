package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// notBlocked is an SQL condition: neither the viewer ($1) nor `col` has blocked the other.
func notBlocked(col string) string {
	return `NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = ` + col +
		`) OR (b.blocker_id = ` + col + ` AND b.blocked_id = $1))`
}

func pathUser(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return 0, false
	}
	if id == userID(r) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "that's you"})
		return 0, false
	}
	return id, true
}

// PUT /users/{id}/block, DELETE /users/{id}/block — COM-05.
func (a *server) block(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUser(w, r)
	if !ok {
		return
	}
	var err error
	if r.Method == http.MethodDelete {
		_, err = a.db.Exec(r.Context(), `DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2`, userID(r), id)
	} else {
		_, err = a.db.Exec(r.Context(), `INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, userID(r), id)
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23503" {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		internalError(w, "block", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GET /me/blocks — people I've blocked.
func (a *server) myBlocks(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.Query(r.Context(), `
		SELECT u.id, u.display_name, u.avatar_key FROM blocks b JOIN users u ON u.id = b.blocked_id
		WHERE b.blocker_id = $1 ORDER BY b.created_at DESC`, userID(r))
	if err != nil {
		internalError(w, "blocks", err)
		return
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (observer, error) {
		var o observer
		var avatar *string
		err := row.Scan(&o.ID, &o.DisplayName, &avatar)
		if avatar != nil {
			u := a.media.url(*avatar)
			o.AvatarURL = &u
		}
		return o, err
	})
	if err != nil {
		internalError(w, "blocks", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

var userReportReasons = []string{"spam", "harassment", "impersonation", "other"}

// POST /users/{id}/report {reason, note} — COM-05; reviewed in the moderation queue (ADM-01).
func (a *server) reportUser(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUser(w, r)
	if !ok {
		return
	}
	var body struct {
		Reason string `json:"reason"`
		Note   string `json:"note"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	body.Note = strings.TrimSpace(body.Note)
	if !slices.Contains(userReportReasons, body.Reason) || len([]rune(body.Note)) > 500 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "reason must be spam, harassment, impersonation or other (note ≤ 500 chars)"})
		return
	}
	if a.rateLimited(r.Context(), "report-user:"+strconv.FormatInt(userID(r), 10), 20, time.Hour) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "too many reports, try again later"})
		return
	}
	_, err := a.db.Exec(r.Context(), `INSERT INTO user_reports (reporter_id, reported_id, reason, note) VALUES ($1, $2, $3, $4)`,
		userID(r), id, body.Reason, body.Note)
	var pgErr *pgconn.PgError
	switch {
	case errors.As(err, &pgErr) && pgErr.Code == "23505":
		writeJSON(w, http.StatusConflict, map[string]string{"error": "you've already reported this"})
	case errors.As(err, &pgErr) && pgErr.Code == "23503":
		http.NotFound(w, r)
	case err != nil:
		internalError(w, "report user", err)
	default:
		w.WriteHeader(http.StatusCreated)
	}
}

// blockedBetween reports whether the caller and other have blocked each other in either direction.
func (a *server) blockedBetween(r *http.Request, other int64) bool {
	var blocked bool
	a.db.QueryRow(r.Context(), `SELECT EXISTS (SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2)
		OR (blocker_id = $2 AND blocked_id = $1))`, userID(r), other).Scan(&blocked)
	return blocked
}
