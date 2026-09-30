package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

// VER-08: is this species unlikely here and now? Judged only inside Sierra Leone, where we have the records.
// "range": never recorded in Sierra Leone. "season": recorded often enough to tell (≥ seasonMinRecords), but
// not in the sighting's month or the months either side.
const seasonMinRecords = 20

func inSierraLeone(lat, lng float64) bool {
	return lat > 6.85 && lat < 10.05 && lng > -13.35 && lng < -10.25
}

func unusualFor(ctx context.Context, q querier, speciesID int64, lat, lng float64, at time.Time) (string, error) {
	if !inSierraLeone(lat, lng) {
		return "", nil
	}
	m := int(at.Month())
	prev, next := (m+10)%12+1, m%12+1
	var records, near int
	err := q.QueryRow(ctx, `SELECT records, months[$2] + months[$3] + months[$4] FROM region_species WHERE species_id = $1`,
		speciesID, m, prev, next).Scan(&records, &near)
	if errors.Is(err, pgx.ErrNoRows) {
		return "range", nil
	}
	if err != nil {
		return "", err
	}
	if records >= seasonMinRecords && near == 0 {
		return "season", nil
	}
	return "", nil
}

// GET /species/{id}/likely?lat=&lng=&date= — the same check before posting, so the app can warn.
func (a *Server) speciesLikely(w http.ResponseWriter, r *http.Request) {
	id, ok := speciesPathID(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	lat, err1 := strconv.ParseFloat(q.Get("lat"), 64)
	lng, err2 := strconv.ParseFloat(q.Get("lng"), 64)
	at, err3 := time.Parse(time.RFC3339, q.Get("date"))
	if err1 != nil || err2 != nil || err3 != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "lat, lng and date (RFC 3339) are required"})
		return
	}
	u, err := unusualFor(r.Context(), a.db, id, lat, lng, at)
	if err != nil {
		internalError(w, "likely", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"unusual": u})
}
