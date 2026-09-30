package api

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

// LRN-04 flashcards: what a card needs for a list of birds, in one request.
// GET /species/cards?ids=1,2,3 (up to 50) — name, photo, a song or call, and a one-line tip.
func (a *Server) speciesCards(w http.ResponseWriter, r *http.Request) {
	ids := quizFocus(r.URL.Query().Get("ids"))
	if len(ids) > 50 {
		ids = ids[:50]
	}
	type card struct {
		lessonBird
		Tip string `json:"tip"`
	}
	expert := map[int64]string{} // LIB-10: an expert's general tip beats the Wikipedia sentence
	rows, err := a.db.Query(r.Context(), `SELECT species_id, text FROM id_tips WHERE other_species_id IS NULL AND species_id = ANY($1)`, ids)
	if err != nil {
		internalError(w, "card tips", err)
		return
	}
	var sid int64
	var text string
	if _, err := pgx.ForEachRow(rows, []any{&sid, &text}, func() error { expert[sid] = text; return nil }); err != nil {
		internalError(w, "card tips", err)
		return
	}
	out := []card{}
	for _, id := range ids {
		birds, err := a.lessonBirdsByID(r, id)
		if err != nil {
			internalError(w, "cards", err)
			return
		}
		for _, b := range birds {
			tip := b.Sexes
			if tip == "" {
				tip = b.Voice
			}
			if i := strings.Index(tip, ". "); i > 0 { // first sentence is enough on a card
				tip = tip[:i+1]
			}
			if t, ok := expert[b.ID]; ok {
				tip = t
			}
			out = append(out, card{b, tip})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

// GET /species/families-of?ids=1,2 (up to 3000) — species id → {name, family}, for the progress dashboard (LRN-06).
func (a *Server) familiesOf(w http.ResponseWriter, r *http.Request) {
	var all []int64
	for s := range strings.SplitSeq(r.URL.Query().Get("ids"), ",") { // quizFocus stops at 100; this list can be long
		if id, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64); err == nil && len(all) < 3000 {
			all = append(all, id)
		}
	}
	rows, err := a.db.Query(r.Context(), `SELECT id::text, family_en, english_name FROM species WHERE id = ANY($1)`, all)
	if err != nil {
		internalError(w, "families of", err)
		return
	}
	type named struct {
		Family string `json:"family"`
		Name   string `json:"name"`
	}
	out := map[string]named{}
	for rows.Next() {
		var id, fam, name string
		if err := rows.Scan(&id, &fam, &name); err != nil {
			rows.Close()
			internalError(w, "families of", err)
			return
		}
		out[id] = named{fam, name}
	}
	rows.Close()
	writeJSON(w, http.StatusOK, out)
}
