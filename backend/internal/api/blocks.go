package api

import (
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// notBlocked is an SQL condition: neither the viewer ($1) nor `col` has blocked the other.
func notBlocked(col string) string {
	return `NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = ` + col +
		`) OR (b.blocker_id = ` + col + ` AND b.blocked_id = $1))`
}

// pathUser is the {id} path user, who must not be the caller.
func pathUser(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, ok := pathID(w, r, "id")
	if ok && id == userID(r) {
		writeError(w, http.StatusBadRequest, "that's you")
		return 0, false
	}
	return id, ok
}

// PUT /users/{id}/block, DELETE /users/{id}/block — COM-05.
func (a *Server) block(w http.ResponseWriter, r *http.Request) {
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
	if pgCode(err) == foreignKeyViolation {
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
func (a *Server) myBlocks(w http.ResponseWriter, r *http.Request) {
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
		o.AvatarURL = a.mediaURL(avatar)
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
func (a *Server) reportUser(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUser(w, r)
	if !ok {
		return
	}
	var body struct {
		Reason string `json:"reason"`
		Note   string `json:"note"`
	}
	if !readJSON(w, r, 4096, &body) {
		return
	}
	body.Note = strings.TrimSpace(body.Note)
	if !slices.Contains(userReportReasons, body.Reason) || len([]rune(body.Note)) > 500 {
		writeError(w, http.StatusBadRequest, "reason must be spam, harassment, impersonation or other (note ≤ 500 chars)")
		return
	}
	if a.rateLimited(r.Context(), "report-user:"+strconv.FormatInt(userID(r), 10), 20, time.Hour) {
		writeError(w, http.StatusTooManyRequests, "too many reports, try again later")
		return
	}
	_, err := a.db.Exec(r.Context(), `INSERT INTO user_reports (reporter_id, reported_id, reason, note) VALUES ($1, $2, $3, $4)`,
		userID(r), id, body.Reason, body.Note)
	switch {
	case pgCode(err) == uniqueViolation:
		writeError(w, http.StatusConflict, "you've already reported this")
	case pgCode(err) == foreignKeyViolation:
		http.NotFound(w, r)
	case err != nil:
		internalError(w, "report user", err)
	default:
		w.WriteHeader(http.StatusCreated)
	}
}

// blockedBetween reports whether the caller and other have blocked each other in either direction.
func (a *Server) blockedBetween(r *http.Request, other int64) bool {
	var blocked bool
	a.db.QueryRow(r.Context(), `SELECT EXISTS (SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2)
		OR (blocker_id = $2 AND blocked_id = $1))`, userID(r), other).Scan(&blocked)
	return blocked
}
