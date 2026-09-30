package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type site struct {
	ID        int64   `json:"id"`
	Name      string  `json:"name"`
	Lat       float64 `json:"lat"`
	Lng       float64 `json:"lng"`
	DistanceM float64 `json:"distance_m,omitempty"`
}

// GET /sites?near=lat,lng — OBS-04: named sites within 5 km, closest first.
func (a *Server) nearbySites(w http.ResponseWriter, r *http.Request) {
	la, lo, ok := strings.Cut(r.URL.Query().Get("near"), ",")
	lat, err1 := strconv.ParseFloat(la, 64)
	lng, err2 := strconv.ParseFloat(lo, 64)
	if !ok || err1 != nil || err2 != nil || lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		writeError(w, http.StatusBadRequest, "near must be lat,lng")
		return
	}
	rows, err := a.db.Query(r.Context(), `
		SELECT id, name, ST_Y(location::geometry), ST_X(location::geometry),
		       ST_Distance(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography)
		FROM sites
		WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, 5000)
		ORDER BY 5 LIMIT 20`, lat, lng)
	if err != nil {
		internalError(w, "nearby sites", err)
		return
	}
	items, err := pgx.CollectRows(rows, pgx.RowToStructByPos[site])
	if err != nil {
		internalError(w, "nearby sites", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// POST /sites {name, lat, lng} — name a place. A site with the same name within 1 km is reused.
func (a *Server) createSite(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string   `json:"name"`
		Lat  *float64 `json:"lat"`
		Lng  *float64 `json:"lng"`
	}
	if !readJSON(w, r, 2048, &body) {
		return
	}
	body.Name = strings.Join(strings.Fields(body.Name), " ")
	if n := len([]rune(body.Name)); n < 2 || n > 80 {
		writeError(w, http.StatusBadRequest, "site name must be 2 to 80 characters")
		return
	}
	if body.Lat == nil || body.Lng == nil || *body.Lat < -90 || *body.Lat > 90 || *body.Lng < -180 || *body.Lng > 180 {
		writeError(w, http.StatusBadRequest, "a valid lat and lng are required")
		return
	}
	if a.rateLimited(r.Context(), "site:"+strconv.FormatInt(userID(r), 10), 30, time.Hour) {
		writeError(w, http.StatusTooManyRequests, "too many new sites, try again later")
		return
	}
	var s site
	err := a.db.QueryRow(r.Context(), `
		SELECT id, name, ST_Y(location::geometry), ST_X(location::geometry) FROM sites
		WHERE lower(name) = lower($1) AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, 1000)
		LIMIT 1`, body.Name, *body.Lat, *body.Lng).Scan(&s.ID, &s.Name, &s.Lat, &s.Lng)
	if err == nil {
		writeJSON(w, http.StatusOK, s)
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		internalError(w, "find site", err)
		return
	}
	err = a.db.QueryRow(r.Context(), `
		INSERT INTO sites (name, location, created_by) VALUES ($1, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, $4)
		RETURNING id, name, ST_Y(location::geometry), ST_X(location::geometry)`,
		body.Name, *body.Lat, *body.Lng, userID(r)).Scan(&s.ID, &s.Name, &s.Lat, &s.Lng)
	if pgCode(err) == checkViolation {
		writeError(w, http.StatusBadRequest, "site name must be 2 to 80 characters")
		return
	}
	if err != nil {
		internalError(w, "create site", err)
		return
	}
	writeJSON(w, http.StatusCreated, s)
}
