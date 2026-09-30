package api

import (
	"net/http"

	"github.com/jackc/pgx/v5"
)

// LIB-05: where the community has seen a species, as grid squares with counts. Never exact points: each
// sighting falls in a ~5 km square, or its species' obscuring cell when sensitive (ADM-03), or ~11 km when
// the observer hides locations (ACC-08) — whichever is coarser. Hidden sightings and blocked people are left out.
const mapCell = 0.05

type mapSquare struct {
	Lat  float64 `json:"lat"` // centre
	Lng  float64 `json:"lng"`
	Cell float64 `json:"cell"` // side, degrees
	N    int     `json:"n"`
}

// GET /species/{id}/sightings-map (optional user, for blocks) — the squares, plus LIB-06 sightings per month (Jan..Dec).
func (a *Server) speciesSightingsMap(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	rows, err := a.db.Query(r.Context(), `
		SELECT round((floor(lat / c) * c + c / 2)::numeric, 4)::float8, round((floor(lng / c) * c + c / 2)::numeric, 4)::float8, c, count(*)::int
		FROM (SELECT ST_Y(o.location::geometry) AS lat, ST_X(o.location::geometry) AS lng,
		             greatest($3, CASE WHEN s.sensitive THEN s.obscure_cell ELSE 0 END, CASE WHEN u.hide_locations THEN 0.1 ELSE 0 END)::float8 AS c
		      FROM observations o
		      JOIN users u ON u.id = o.user_id
		      JOIN species s ON s.id = coalesce(o.community_species_id, o.species_id)
		      WHERE s.id = $2 AND NOT o.hidden AND `+notBlocked("o.user_id")+`) x
		GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 2000`, viewerID(r), id, mapCell)
	if err != nil {
		internalError(w, "sightings map", err)
		return
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (mapSquare, error) {
		var m mapSquare
		return m, row.Scan(&m.Lat, &m.Lng, &m.Cell, &m.N)
	})
	if err != nil {
		internalError(w, "sightings map", err)
		return
	}
	months := make([]int, 12)
	mrows, err := a.db.Query(r.Context(), `
		SELECT extract(month FROM o.observed_at)::int, count(*)::int
		FROM observations o JOIN species s ON s.id = coalesce(o.community_species_id, o.species_id)
		WHERE s.id = $2 AND NOT o.hidden AND `+notBlocked("o.user_id")+` GROUP BY 1`, viewerID(r), id)
	if err != nil {
		internalError(w, "sightings by month", err)
		return
	}
	var m, n int
	if _, err := pgx.ForEachRow(mrows, []any{&m, &n}, func() error { months[m-1] = n; return nil }); err != nil {
		internalError(w, "sightings by month", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "months": months})
}
