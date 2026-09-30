package api

import (
	"encoding/json"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

// ADM-04 (admin): find people and set their role. Admins can't change their own role (no locking yourself out).

type personRow struct {
	ID          int64   `json:"id"`
	DisplayName string  `json:"display_name"`
	Email       string  `json:"email"`
	Role        string  `json:"role"`
	AvatarURL   *string `json:"avatar_url"`
}

// GET /admin/users?q= — by name or email; with no q, everyone above member first.
func (a *Server) searchUsers(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	rows, err := a.db.Query(r.Context(), `
		SELECT id, display_name, email, role::text, avatar_key FROM users
		WHERE $1 = '' OR display_name ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%'
		ORDER BY role DESC, display_name LIMIT 50`, q)
	if err != nil {
		internalError(w, "search users", err)
		return
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (personRow, error) {
		var p personRow
		var avatar *string
		err := row.Scan(&p.ID, &p.DisplayName, &p.Email, &p.Role, &avatar)
		p.AvatarURL = a.mediaURL(avatar)
		return p, err
	})
	if err != nil {
		internalError(w, "search users", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// PUT /admin/users/{id}/role {role}
func (a *Server) setUserRole(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	var body struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&body); err != nil || !slices.Contains(roles, body.Role) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "role must be one of " + strings.Join(roles, ", ")})
		return
	}
	if id == userID(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "you can't change your own role"})
		return
	}
	var before string
	err = pgx.BeginFunc(r.Context(), a.db, func(tx pgx.Tx) error {
		if err := tx.QueryRow(r.Context(), `SELECT role::text FROM users WHERE id = $1 FOR UPDATE`, id).Scan(&before); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `UPDATE users SET role = $2 WHERE id = $1`, id, body.Role); err != nil {
			return err
		}
		_, err := tx.Exec(r.Context(), `INSERT INTO moderation_actions (moderator_id, target_type, target_id, action, note)
			VALUES ($1, 'user', $2, 'role', $3)`, userID(r), id, before+" → "+body.Role)
		return err
	})
	if err == pgx.ErrNoRows {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		internalError(w, "set role", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
