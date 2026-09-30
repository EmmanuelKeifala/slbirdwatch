package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// VER-09 comments on sightings.

type comment struct {
	ID        int64     `json:"id"`
	ParentID  *int64    `json:"parent_id"`
	Author    observer  `json:"author"`
	Body      string    `json:"body"` // "" when deleted
	Deleted   bool      `json:"deleted"`
	Hidden    bool      `json:"hidden"` // only moderators see hidden comments (flagged so)
	CreatedAt time.Time `json:"created_at"`
	Replies   []comment `json:"replies"` // on threads; null on replies
}

// GET /observations/{id}/comments — threads, oldest first. Hidden comments are left out (moderators see them,
// marked); comments between people who blocked each other are left out; deleted ones keep their place.
func (a *Server) listComments(w http.ResponseWriter, r *http.Request) {
	oid, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	viewer := viewerID(r)
	var mod bool
	if viewer != 0 {
		var role string
		a.db.QueryRow(r.Context(), `SELECT role FROM users WHERE id = $1`, viewer).Scan(&role)
		mod = roleAtLeast(role, "moderator")
	}
	rows, err := a.db.Query(r.Context(), `
		SELECT c.id, c.parent_id, u.id, u.display_name, u.avatar_key, c.body, c.deleted, c.hidden, c.created_at
		FROM comments c JOIN users u ON u.id = c.user_id
		WHERE c.observation_id = $2 AND (NOT c.hidden OR $3) AND `+notBlocked("c.user_id")+`
		ORDER BY c.created_at, c.id`, viewer, oid, mod)
	if err != nil {
		internalError(w, "comments", err)
		return
	}
	all, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (comment, error) {
		var c comment
		var avatar *string
		err := row.Scan(&c.ID, &c.ParentID, &c.Author.ID, &c.Author.DisplayName, &avatar, &c.Body, &c.Deleted, &c.Hidden, &c.CreatedAt)
		c.Author.AvatarURL = a.mediaURL(avatar)
		if c.Deleted {
			c.Body = ""
		}
		return c, err
	})
	if err != nil {
		internalError(w, "comments", err)
		return
	}
	threads := []comment{}
	index := map[int64]int{}
	for _, c := range all {
		if c.ParentID == nil {
			c.Replies = []comment{} // always a list on threads
			index[c.ID] = len(threads)
			threads = append(threads, c)
		}
	}
	for _, c := range all {
		if c.ParentID != nil {
			if i, ok := index[*c.ParentID]; ok {
				threads[i].Replies = append(threads[i].Replies, c)
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": threads})
}

// POST /observations/{id}/comments {body, parent_id?}
func (a *Server) addComment(w http.ResponseWriter, r *http.Request) {
	oid, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	var body struct {
		Body     string `json:"body"`
		ParentID *int64 `json:"parent_id"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	body.Body = strings.TrimSpace(body.Body)
	if body.Body == "" || len([]rune(body.Body)) > 1000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a comment must be 1 to 1000 characters"})
		return
	}
	if a.rateLimited(r.Context(), "comment:"+strconv.FormatInt(userID(r), 10), 60, time.Hour) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "too many comments, try again later"})
		return
	}
	var owner int64
	err = a.db.QueryRow(r.Context(), `SELECT user_id FROM observations WHERE id = $1 AND NOT hidden`, oid).Scan(&owner)
	if errors.Is(err, pgx.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		internalError(w, "comment", err)
		return
	}
	if a.blockedBetween(r, owner) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "you can't comment on this sighting"})
		return
	}
	var parentAuthor int64
	if body.ParentID != nil {
		var topLevel bool
		err := a.db.QueryRow(r.Context(), `SELECT user_id, parent_id IS NULL FROM comments WHERE id = $1 AND observation_id = $2 AND NOT hidden`,
			*body.ParentID, oid).Scan(&parentAuthor, &topLevel)
		if err != nil || !topLevel {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "you can reply to a comment on this sighting"})
			return
		}
		if a.blockedBetween(r, parentAuthor) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "you can't reply to this comment"})
			return
		}
	}
	var id int64
	err = pgx.BeginFunc(r.Context(), a.db, func(tx pgx.Tx) error {
		if err := tx.QueryRow(r.Context(), `INSERT INTO comments (observation_id, user_id, parent_id, body) VALUES ($1, $2, $3, $4) RETURNING id`,
			oid, userID(r), body.ParentID, body.Body).Scan(&id); err != nil {
			return err
		}
		// Notify the sighting's owner, and the person replied to (once each, never yourself).
		for kind, who := range map[string]int64{"comment": owner, "reply": parentAuthor} {
			if who == 0 || who == userID(r) || (kind == "comment" && who == parentAuthor) {
				continue
			}
			if _, err := tx.Exec(r.Context(), `INSERT INTO notifications (user_id, kind, observation_id, actor_id)
				SELECT $1, $2, $3, $4 FROM users WHERE id = $1 AND notify_comments`, who, kind, oid, userID(r)); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		internalError(w, "add comment", err)
		return
	}
	for _, who := range []int64{owner, parentAuthor} {
		if who != 0 && who != userID(r) {
			go a.pushUser(who)
		}
	}
	writeJSON(w, http.StatusCreated, map[string]int64{"id": id})
}

// DELETE /comments/{id} — the author removes their words; replies stay in place.
func (a *Server) deleteComment(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	tag, err := a.db.Exec(r.Context(), `UPDATE comments SET deleted = true, body = '-' WHERE id = $1 AND user_id = $2`, id, userID(r))
	if err != nil {
		internalError(w, "delete comment", err)
		return
	}
	if tag.RowsAffected() == 0 {
		http.NotFound(w, r)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// POST /comments/{id}/report {reason} — once per person per comment.
func (a *Server) reportComment(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&body)
	switch body.Reason {
	case "spam", "harassment", "inappropriate", "other":
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "reason must be spam, harassment, inappropriate or other"})
		return
	}
	tag, err := a.db.Exec(r.Context(), `INSERT INTO comment_reports (comment_id, user_id, reason)
		SELECT id, $2, $3 FROM comments WHERE id = $1 AND user_id <> $2 ON CONFLICT DO NOTHING`, id, userID(r), body.Reason)
	if err != nil {
		internalError(w, "report comment", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "you've already reported this comment (or it's yours)"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// POST /mod/comments/{id} {action: hide|restore|dismiss, note} (moderator+).
func (a *Server) moderateComment(w http.ResponseWriter, r *http.Request) {
	id, m, ok := readModAction(w, r, "hide", "restore", "dismiss")
	if !ok {
		return
	}
	err := pgx.BeginFunc(r.Context(), a.db, func(tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(r.Context(), `SELECT true FROM comments WHERE id = $1`, id).Scan(&exists); err != nil {
			return err
		}
		if m.Action != "dismiss" {
			if _, err := tx.Exec(r.Context(), `UPDATE comments SET hidden = $2 WHERE id = $1`, id, m.Action == "hide"); err != nil {
				return err
			}
		}
		status := map[string]string{"hide": "resolved", "dismiss": "dismissed"}[m.Action]
		if status != "" {
			if _, err := tx.Exec(r.Context(), `UPDATE comment_reports SET status = $2, closed_at = now() WHERE comment_id = $1 AND status = 'open'`, id, status); err != nil {
				return err
			}
		}
		_, err := tx.Exec(r.Context(), `INSERT INTO moderation_actions (moderator_id, target_type, target_id, action, note)
			VALUES ($1, 'comment', $2, $3, $4)`, userID(r), id, m.Action, m.Note)
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		internalError(w, "moderate comment", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
