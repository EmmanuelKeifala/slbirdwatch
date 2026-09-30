package api

import (
	"net/http"
	"strings"
)

// LRN-08: memory phrases for songs and calls.

// PUT /species/{id}/mnemonic {text} (verifier+) — sets the phrase; empty text removes it.
func (a *Server) putMnemonic(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var body struct {
		Text string `json:"text"`
	}
	if !readJSON(w, r, 2048, &body) {
		return
	}
	body.Text = strings.TrimSpace(body.Text)
	var err error
	if body.Text == "" {
		_, err = a.db.Exec(r.Context(), `DELETE FROM species_mnemonics WHERE species_id = $1`, id)
	} else if n := len([]rune(body.Text)); n < 3 || n > 140 {
		writeError(w, http.StatusBadRequest, "a memory phrase is 3–140 characters")
		return
	} else {
		var tag interface{ RowsAffected() int64 }
		tag, err = a.db.Exec(r.Context(), `
			INSERT INTO species_mnemonics (species_id, text, author_id) SELECT id, $2, $3 FROM species WHERE id = $1
			ON CONFLICT (species_id) DO UPDATE SET text = $2, author_id = $3, updated_at = now()`, id, body.Text, userID(r))
		if err == nil && tag.RowsAffected() == 0 {
			http.NotFound(w, r)
			return
		}
	}
	if err != nil {
		internalError(w, "mnemonic", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"mnemonic": body.Text})
}
