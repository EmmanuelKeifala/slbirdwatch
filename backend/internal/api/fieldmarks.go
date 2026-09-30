package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

// LRN-03: labelled field marks on reference photos, placed by verifiers, shown to everyone in the photo viewer.

type photoMark struct {
	ID    int64   `json:"id"`
	X     float64 `json:"x"` // 0..1 across
	Y     float64 `json:"y"` // 0..1 down
	Label string  `json:"label"`
}

const maxMarksPerPhoto = 8

// POST /photos/marks {media_ref, x, y, label} (verifier+) — only on reference photos, at most 8 each.
func (a *Server) addFieldMark(w http.ResponseWriter, r *http.Request) {
	var body struct {
		MediaRef string  `json:"media_ref"`
		X        float64 `json:"x"`
		Y        float64 `json:"y"`
		Label    string  `json:"label"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	body.Label = strings.TrimSpace(body.Label)
	if n := len([]rune(body.Label)); n < 2 || n > 40 || body.X < 0 || body.X > 1 || body.Y < 0 || body.Y > 1 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a label of 2–40 characters, and a spot on the photo"})
		return
	}
	kind, idStr, _ := strings.Cut(body.MediaRef, ":")
	id, err := strconv.ParseInt(idStr, 10, 64)
	var ref bool
	switch {
	case err != nil:
	case kind == "gallery":
		err = a.db.QueryRow(r.Context(), `SELECT reference FROM species_gallery WHERE id = $1`, id).Scan(&ref)
	case kind == "photo":
		err = a.db.QueryRow(r.Context(), `SELECT reference FROM media WHERE id = $1 AND kind = 'photo'`, id).Scan(&ref)
	default:
		err = pgx.ErrNoRows
	}
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !ref) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "field marks go on reference photos: mark it as one first"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": `media_ref must be "gallery:<id>" or "photo:<id>"`})
		return
	}
	var m photoMark
	err = a.db.QueryRow(r.Context(), `
		INSERT INTO field_marks (media_ref, x, y, label, author_id)
		SELECT $1, $2, $3, $4, $5 WHERE (SELECT count(*) FROM field_marks WHERE media_ref = $1) < $6
		RETURNING id, x, y, label`, kind+":"+strconv.FormatInt(id, 10), body.X, body.Y, body.Label, userID(r), maxMarksPerPhoto).
		Scan(&m.ID, &m.X, &m.Y, &m.Label)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a photo can have at most 8 marks"})
		return
	}
	if err != nil {
		internalError(w, "add field mark", err)
		return
	}
	writeJSON(w, http.StatusCreated, m)
}

// DELETE /photos/marks/{id} (verifier+)
func (a *Server) deleteFieldMark(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	tag, err := a.db.Exec(r.Context(), `DELETE FROM field_marks WHERE id = $1`, id)
	if err != nil {
		internalError(w, "delete field mark", err)
		return
	}
	if tag.RowsAffected() == 0 {
		http.NotFound(w, r)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
