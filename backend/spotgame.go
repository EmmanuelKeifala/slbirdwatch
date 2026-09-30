package main

import (
	"math/rand/v2"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
)

// QZ-07 "Spot the difference": two lookalike Sierra Leone birds (same genus, both with a photo), unlabelled —
// which one is the named bird? The answer shows how to tell them apart: the experts' ID tip for the pair
// (LIB-10; such pairs are picked first), else their sizes.

type spotBird struct {
	ID             int64  `json:"id"`
	EnglishName    string `json:"english_name"`
	ScientificName string `json:"scientific_name"`
	Photo          string `json:"photo"`
	Credit         string `json:"credit"`
	Length         string `json:"length"`
}

type spotRound struct {
	Target spotBird    `json:"target"`
	Birds  [2]spotBird `json:"birds"` // shuffled; one is the target
	Tip    string      `json:"tip"`   // how to tell them apart, when an expert has written it
}

// GET /games/spot?n=5 (1–10)
func (a *server) spotGame(w http.ResponseWriter, r *http.Request) {
	n, _ := strconv.Atoi(r.URL.Query().Get("n"))
	if n < 1 || n > 10 {
		n = 5
	}
	rows, err := a.db.Query(r.Context(), `
		WITH sl AS (
			SELECT s.id, s.genus, s.english_name, s.scientific_name, coalesce(d.length_text, '') AS length,
			       coalesce(si.thumb_key, g.thumb_key) AS img, coalesce(si.credit, g.credit, '') AS credit
			FROM species s JOIN region_species rs ON rs.species_id = s.id
			LEFT JOIN species_images si ON si.species_id = s.id AND si.status = 'ok'
			LEFT JOIN LATERAL (SELECT thumb_key, credit FROM species_gallery WHERE species_id = s.id ORDER BY reference DESC, id LIMIT 1) g ON true
			LEFT JOIN species_details d ON d.species_id = s.id AND d.status = 'ok'
			WHERE NOT s.extinct AND s.merged_into IS NULL),
		pairs AS (
			SELECT DISTINCT ON (a.id) a.id AS a, b.id AS b, coalesce(t.text, '') AS tip FROM sl a
			JOIN sl b ON b.genus = a.genus AND b.id <> a.id AND b.img IS NOT NULL
			LEFT JOIN id_tips t ON t.species_id = least(a.id, b.id) AND t.other_species_id = greatest(a.id, b.id)
			WHERE a.img IS NOT NULL
			ORDER BY a.id, (t.text IS NULL), random())
		SELECT x.id, x.english_name, x.scientific_name, x.img, x.credit, x.length,
		       y.id, y.english_name, y.scientific_name, y.img, y.credit, y.length, p.tip
		FROM pairs p JOIN sl x ON x.id = p.a JOIN sl y ON y.id = p.b
		ORDER BY (p.tip = ''), random() LIMIT $1`, n)
	if err != nil {
		internalError(w, "spot game", err)
		return
	}
	rounds, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (spotRound, error) {
		var g spotRound
		var a, b spotBird
		err := row.Scan(&a.ID, &a.EnglishName, &a.ScientificName, &a.Photo, &a.Credit, &a.Length,
			&b.ID, &b.EnglishName, &b.ScientificName, &b.Photo, &b.Credit, &b.Length, &g.Tip)
		g.Birds = [2]spotBird{a, b}
		rand.Shuffle(2, func(i, j int) { g.Birds[i], g.Birds[j] = g.Birds[j], g.Birds[i] })
		g.Target = g.Birds[rand.IntN(2)]
		return g, err
	})
	if err != nil {
		internalError(w, "spot game", err)
		return
	}
	for i := range rounds {
		for j := range rounds[i].Birds {
			rounds[i].Birds[j].Photo = a.media.url(rounds[i].Birds[j].Photo)
		}
		rounds[i].Target.Photo = a.media.url(rounds[i].Target.Photo)
	}
	writeJSON(w, http.StatusOK, map[string]any{"rounds": rounds})
}
