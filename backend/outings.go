package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// OBS-10 outings. The phone creates and ends an outing through the same idempotent call (keyed by its own
// client_id), so it works from the offline queue: POST once at the start (or with the first sighting), again at
// the end with ended_at and the route. Distance comes from PostGIS; the summary counts sightings and species.

type routePoint [2]float64 // lat, lng

// POST /outings {client_id, started_at, ended_at?, route?: [[lat, lng], ...]} — creates or updates; returns the outing.
func (a *server) upsertOuting(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ClientID  string       `json:"client_id"`
		StartedAt time.Time    `json:"started_at"`
		EndedAt   *time.Time   `json:"ended_at"`
		Route     []routePoint `json:"route"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	now := time.Now().Add(10 * time.Minute)
	switch {
	case body.ClientID == "" || len(body.ClientID) > 64:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "client_id is required"})
		return
	case body.StartedAt.IsZero() || body.StartedAt.After(now):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "started_at must be a time in the past"})
		return
	case body.EndedAt != nil && (body.EndedAt.Before(body.StartedAt) || body.EndedAt.After(now) || body.EndedAt.Sub(body.StartedAt) > 72*time.Hour):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ended_at must be after the start and within 3 days"})
		return
	case len(body.Route) > 20000:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "route has too many points"})
		return
	}
	var line any // WKT LineString, or nil to keep what's stored
	if len(body.Route) >= 2 {
		pts := make([]string, 0, len(body.Route))
		for _, p := range body.Route {
			if p[0] < -90 || p[0] > 90 || p[1] < -180 || p[1] > 180 {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "route has an invalid point"})
				return
			}
			pts = append(pts, fmt.Sprintf("%f %f", p[1], p[0]))
		}
		line = "LINESTRING(" + strings.Join(pts, ",") + ")"
	}
	var id int64
	err := a.db.QueryRow(r.Context(), `
		INSERT INTO outings (user_id, client_id, started_at, ended_at, route)
		VALUES ($1, $2, $3, $4, ST_GeogFromText($5))
		ON CONFLICT (user_id, client_id) DO UPDATE SET
			ended_at = coalesce(excluded.ended_at, outings.ended_at), route = coalesce(excluded.route, outings.route)
		RETURNING id`, userID(r), body.ClientID, body.StartedAt, body.EndedAt, line).Scan(&id)
	if err != nil {
		internalError(w, "upsert outing", err)
		return
	}
	a.respondOuting(w, r, id)
}

type outingSummary struct {
	ID        int64          `json:"id"`
	StartedAt time.Time      `json:"started_at"`
	EndedAt   *time.Time     `json:"ended_at"`
	Minutes   int            `json:"minutes"`
	DistanceM int            `json:"distance_m"`
	Route     []routePoint   `json:"route"`
	Sightings int            `json:"sightings"`
	Species   []outingSpecie `json:"species"` // most seen first
}

type outingSpecie struct {
	ID          int64  `json:"id"`
	EnglishName string `json:"english_name"`
	Count       int    `json:"count"` // birds counted across sightings
}

// GET /outings/{id} — the outing's owner only.
func (a *server) getOuting(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	a.respondOuting(w, r, id)
}

func (a *server) respondOuting(w http.ResponseWriter, r *http.Request, id int64) {
	var o outingSummary
	var route *string
	err := a.db.QueryRow(r.Context(), `
		SELECT id, started_at, ended_at, coalesce(ST_Length(route), 0)::int, ST_AsGeoJSON(route),
		       (SELECT count(*) FROM observations WHERE outing_id = outings.id)
		FROM outings WHERE id = $1 AND user_id = $2`, id, userID(r)).
		Scan(&o.ID, &o.StartedAt, &o.EndedAt, &o.DistanceM, &route, &o.Sightings)
	if errors.Is(err, pgx.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		internalError(w, "outing", err)
		return
	}
	end := time.Now()
	if o.EndedAt != nil {
		end = *o.EndedAt
	}
	o.Minutes = int(end.Sub(o.StartedAt).Minutes())
	o.Route = []routePoint{}
	if route != nil {
		var g struct{ Coordinates [][2]float64 }
		json.Unmarshal([]byte(*route), &g)
		for _, c := range g.Coordinates {
			o.Route = append(o.Route, routePoint{c[1], c[0]})
		}
	}
	rows, err := a.db.Query(r.Context(), `
		SELECT s.id, s.english_name, sum(o.count)::int FROM observations o
		JOIN species s ON s.id = coalesce(o.community_species_id, o.species_id)
		WHERE o.outing_id = $1 GROUP BY s.id, s.english_name ORDER BY 3 DESC, 2`, id)
	if err != nil {
		internalError(w, "outing species", err)
		return
	}
	if o.Species, err = pgx.CollectRows(rows, pgx.RowToStructByPos[outingSpecie]); err != nil {
		internalError(w, "outing species", err)
		return
	}
	writeJSON(w, http.StatusOK, o)
}

// GET /me/outings — newest first, with counts (no routes).
func (a *server) myOutings(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.Query(r.Context(), `
		SELECT o.id, o.started_at, o.ended_at, coalesce(ST_Length(o.route), 0)::int,
		       count(ob.id)::int, count(DISTINCT coalesce(ob.community_species_id, ob.species_id))::int
		FROM outings o LEFT JOIN observations ob ON ob.outing_id = o.id
		WHERE o.user_id = $1 GROUP BY o.id ORDER BY o.started_at DESC LIMIT 50`, userID(r))
	if err != nil {
		internalError(w, "my outings", err)
		return
	}
	type row struct {
		ID        int64      `json:"id"`
		StartedAt time.Time  `json:"started_at"`
		EndedAt   *time.Time `json:"ended_at"`
		DistanceM int        `json:"distance_m"`
		Sightings int        `json:"sightings"`
		Species   int        `json:"species"`
	}
	items, err := pgx.CollectRows(rows, pgx.RowToStructByPos[row])
	if err != nil {
		internalError(w, "my outings", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}
