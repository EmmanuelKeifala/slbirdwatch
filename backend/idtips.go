package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// LIB-10: expert-written ID tips ("how to tell it apart"), by verifiers and up.

type idTip struct {
	ID        int64       `json:"id"`
	Other     *speciesRef `json:"other"` // the lookalike; nil for a general tip
	Text      string      `json:"text"`
	Author    string      `json:"author"`
	UpdatedAt time.Time   `json:"updated_at"`
}

// GET /species/{id}/tips — the bird's general tip first, then its pair tips, newest first.
func (a *server) listTips(w http.ResponseWriter, r *http.Request) {
	id, ok := speciesPathID(w, r)
	if !ok {
		return
	}
	rows, err := a.db.Query(r.Context(), `
		SELECT t.id, o.id, o.english_name, o.scientific_name, t.text, coalesce(u.display_name, ''), t.updated_at
		FROM id_tips t
		LEFT JOIN species o ON o.id = CASE WHEN t.species_id = $1 THEN t.other_species_id ELSE t.species_id END
		LEFT JOIN users u ON u.id = t.author_id
		WHERE t.species_id = $1 OR t.other_species_id = $1
		ORDER BY t.other_species_id IS NOT NULL, t.updated_at DESC`, id)
	if err != nil {
		internalError(w, "list tips", err)
		return
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (idTip, error) {
		var t idTip
		var oid *int64
		var en, sci *string
		err := row.Scan(&t.ID, &oid, &en, &sci, &t.Text, &t.Author, &t.UpdatedAt)
		if oid != nil {
			t.Other = &speciesRef{ID: *oid, EnglishName: *en, ScientificName: *sci}
		}
		return t, err
	})
	if err != nil {
		internalError(w, "list tips", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// PUT /species/{id}/tips {other_species_id?, text} (verifier+) — writes the tip for this bird or this pair,
// replacing what was there.
func (a *server) putTip(w http.ResponseWriter, r *http.Request) {
	id, ok := speciesPathID(w, r)
	if !ok {
		return
	}
	var body struct {
		Other *int64 `json:"other_species_id"`
		Text  string `json:"text"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	body.Text = strings.TrimSpace(body.Text)
	if n := len([]rune(body.Text)); n < 10 || n > 1000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a tip is 10 to 1000 characters"})
		return
	}
	a1, a2 := id, body.Other
	if body.Other != nil {
		if *body.Other == id {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "pick a different bird to compare with"})
			return
		}
		lo, hi := min(id, *body.Other), max(id, *body.Other)
		a1, a2 = lo, &hi
	}
	var t idTip
	err := a.db.QueryRow(r.Context(), `
		INSERT INTO id_tips (species_id, other_species_id, text, author_id)
		SELECT $1, $2, $3, $4 WHERE EXISTS (SELECT 1 FROM species WHERE id = $1)
		  AND ($2::bigint IS NULL OR EXISTS (SELECT 1 FROM species WHERE id = $2))
		ON CONFLICT (species_id, other_species_id) DO UPDATE SET text = $3, author_id = $4, updated_at = now()
		RETURNING id, updated_at`, a1, a2, body.Text, userID(r)).Scan(&t.ID, &t.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such species"})
		return
	}
	if err != nil {
		internalError(w, "put tip", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": t.ID, "updated_at": t.UpdatedAt})
}

// DELETE /tips/{id} (verifier+)
func (a *server) deleteTip(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	tag, err := a.db.Exec(r.Context(), `DELETE FROM id_tips WHERE id = $1`, id)
	if err != nil {
		internalError(w, "delete tip", err)
		return
	}
	if tag.RowsAffected() == 0 {
		http.NotFound(w, r)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
