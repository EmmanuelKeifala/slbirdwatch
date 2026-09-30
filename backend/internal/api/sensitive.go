package api

import (
	"net/http"

	"github.com/jackc/pgx/v5"
)

// ADM-03 (admin): which species are sensitive and how far their locations are blurred for other people.

// Obscuring levels offered to admins: km (roughly) → grid cell in degrees.
var obscureLevels = map[int]float64{11: 0.1, 22: 0.2, 55: 0.5}

func cellKm(cell float64) int {
	for km, c := range obscureLevels {
		if c == cell {
			return km
		}
	}
	return 11
}

type sensitiveSpecies struct {
	ID             int64  `json:"id"`
	EnglishName    string `json:"english_name"`
	ScientificName string `json:"scientific_name"`
	Km             int    `json:"km"`
	Local          bool   `json:"local"` // recorded in Sierra Leone
}

// GET /admin/sensitive — every sensitive species with its obscuring level, Sierra Leone birds first.
func (a *Server) listSensitive(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.Query(r.Context(), `
		SELECT s.id, s.english_name, s.scientific_name, s.obscure_cell::float8, EXISTS (SELECT 1 FROM region_species rs WHERE rs.species_id = s.id)
		FROM species s WHERE s.sensitive ORDER BY 5 DESC, s.english_name`)
	if err != nil {
		internalError(w, "list sensitive", err)
		return
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (sensitiveSpecies, error) {
		var s sensitiveSpecies
		var cell float64
		err := row.Scan(&s.ID, &s.EnglishName, &s.ScientificName, &cell, &s.Local)
		s.Km = cellKm(cell)
		return s, err
	})
	if err != nil {
		internalError(w, "list sensitive", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// PUT /admin/species/{id}/sensitive {sensitive, km: 11|22|55}
func (a *Server) setSensitive(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var body struct {
		Sensitive bool `json:"sensitive"`
		Km        int  `json:"km"`
	}
	if !readJSON(w, r, 1024, &body) {
		return
	}
	if body.Km == 0 {
		body.Km = 11
	}
	cell, ok := obscureLevels[body.Km]
	if !ok {
		writeError(w, http.StatusBadRequest, "km must be 11, 22 or 55")
		return
	}
	tag, err := a.db.Exec(r.Context(), `UPDATE species SET sensitive = $2, obscure_cell = $3 WHERE id = $1`, id, body.Sensitive, cell)
	if err != nil {
		internalError(w, "set sensitive", err)
		return
	}
	if tag.RowsAffected() == 0 {
		http.NotFound(w, r)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
