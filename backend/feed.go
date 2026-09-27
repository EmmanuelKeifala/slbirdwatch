package main

import (
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

// listObservations runs a filtered observation query, applies redaction for the viewer, attaches photos,
// and writes a page. where/args are ANDed onto observationSelect; $1 is reserved for the viewer id.
func (a *server) listObservations(w http.ResponseWriter, r *http.Request, where []string, args []any, redact bool) {
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	offset = max(offset, 0)
	const limit = 30
	args = append([]any{viewerID(r)}, args...)
	sql := observationSelect
	if len(where) > 0 {
		sql += " WHERE " + strings.Join(where, " AND ")
	}
	sql += fmt.Sprintf(" ORDER BY o.created_at DESC, o.id DESC LIMIT %d OFFSET %d", limit+1, offset)
	rows, err := a.db.Query(r.Context(), sql, args...)
	if err != nil {
		internalError(w, "list observations", err)
		return
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (observation, error) { return a.scanObservation(row) })
	for i := 0; err == nil && redact && i < len(items); i++ {
		err = a.redact(r.Context(), &items[i], viewerID(r))
	}
	if err == nil {
		err = a.withPhotos(r.Context(), items)
	}
	if err != nil {
		internalError(w, "list observations", err)
		return
	}
	resp := map[string]any{"items": items, "next_offset": nil}
	if len(items) > limit {
		resp["items"], resp["next_offset"] = items[:limit], offset+limit
	}
	writeJSON(w, http.StatusOK, resp)
}

// GET /observations?status=needs_id|community|verified&not_mine=1 — public feed, newest first, redacted (OBS-14/ACC-08).
func (a *server) feed(w http.ResponseWriter, r *http.Request) {
	var where []string
	var args []any
	if st := r.URL.Query().Get("status"); st != "" {
		if !slices.Contains([]string{"needs_id", "community", "verified"}, st) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "status must be needs_id, community or verified"})
			return
		}
		args = append(args, st)
		where = append(where, fmt.Sprintf("o.status = $%d", len(args)+1))
	}
	if r.URL.Query().Get("not_mine") == "1" {
		where = append(where, "o.user_id <> $1")
	}
	where = append(where, notBlocked("o.user_id"), "NOT o.hidden") // COM-05, ADM-01
	a.listObservations(w, r, where, args, true)
}

// GET /verify/queue?family=&has_photo=1&min_lat=&max_lat=&min_lng=&max_lng= — VER-03, verifiers+.
// Everything not yet verified and not the verifier's own, filterable by family, photos and area. Exact locations.
func (a *server) verifyQueue(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	// ADM-02: sightings of a split species come back for re-identification even when verified.
	where := []string{"(o.status <> 'verified' OR EXISTS (SELECT 1 FROM species x WHERE x.id = coalesce(o.community_species_id, o.species_id) AND x.split_into <> '{}'))",
		"o.user_id <> $1", "NOT o.hidden"}
	var args []any
	if f := q.Get("family"); f != "" {
		args = append(args, f)
		where = append(where, fmt.Sprintf("coalesce(cs.family_sci, s.family_sci) = $%d", len(args)+1))
	}
	if q.Get("unusual") == "1" { // VER-08: unlikely for the place or date
		where = append(where, "o.unusual <> ''")
	}
	if q.Get("has_photo") == "1" {
		where = append(where, "EXISTS (SELECT 1 FROM media m WHERE m.observation_id = o.id AND m.kind = 'photo')")
	}
	if q.Get("min_lat") != "" {
		var box [4]float64
		for i, k := range []string{"min_lat", "max_lat", "min_lng", "max_lng"} {
			v, err := strconv.ParseFloat(q.Get(k), 64)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "min_lat, max_lat, min_lng and max_lng must all be numbers"})
				return
			}
			box[i] = v
		}
		args = append(args, box[2], box[0], box[3], box[1])
		n := len(args) + 1 // placeholder of the last arg ($1 is the viewer)
		where = append(where, fmt.Sprintf("o.location && ST_MakeEnvelope($%d, $%d, $%d, $%d, 4326)::geography", n-3, n-2, n-1, n))
	}
	a.listObservations(w, r, where, args, false)
}
