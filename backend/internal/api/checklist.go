package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

// LIB-13: "birds recorded in this area" — GBIF records within the radius (open data, cached a day) plus the
// community's trusted sightings (community ID or verified), with how common each bird is here.
// Sensitive species are never listed, as with "near me" in the library.

var areaGBIF = &gbifClient{http: &http.Client{Timeout: 8 * time.Second}, base: "https://api.gbif.org"} // base swapped in tests

type areaBird struct {
	speciesItem
	GBIF      int        `json:"gbif"`      // GBIF records within the radius
	Community int        `json:"community"` // trusted sightings in this app
	LastSeen  *time.Time `json:"last_seen"` // newest community sighting
	Rarity    string     `json:"rarity"`    // common | uncommon | rare (here, relative to the area's best-recorded bird)
}

// rarityOf grades a bird by its share of the area's most-recorded bird.
// ponytail: record counts track birder effort as much as birds; switch to checklist frequency once we log complete lists.
func rarityOf(n, top int) string {
	switch r := float64(n) / float64(max(top, 1)); {
	case r >= 0.15:
		return "common"
	case r >= 0.03:
		return "uncommon"
	}
	return "rare"
}

// gbifArea returns GBIF speciesKey → records within km of the point; ok=false when GBIF couldn't be reached.
func (a *Server) gbifArea(ctx context.Context, lat, lng float64, km int) (map[string]int, bool) {
	key := fmt.Sprintf("area:%.2f,%.2f,%d", lat, lng, km)
	counts := map[string]int{}
	if b, err := a.cache.Get(ctx, key).Bytes(); err == nil && json.Unmarshal(b, &counts) == nil {
		return counts, true
	}
	q := url.Values{"geoDistance": {fmt.Sprintf("%.4f,%.4f,%dkm", lat, lng, km)}, "classKey": {"212"}, "occurrenceStatus": {"PRESENT"},
		"hasGeospatialIssue": {"false"}, "limit": {"0"}, "facet": {"speciesKey"}, "facetLimit": {"1000"}}
	var page struct {
		Facets []struct {
			Counts []struct {
				Name  string `json:"name"`
				Count int    `json:"count"`
			} `json:"counts"`
		} `json:"facets"`
	}
	if err := areaGBIF.getOnce(ctx, "/v1/occurrence/search?"+q.Encode(), &page); err != nil {
		log.Printf("area checklist: gbif: %v", err)
		return counts, false
	}
	for _, f := range page.Facets {
		for _, c := range f.Counts {
			counts[c.Name] = c.Count
		}
	}
	if b, err := json.Marshal(counts); err == nil {
		a.cache.Set(ctx, key, b, 24*time.Hour)
	}
	return counts, true
}

// GET /area/checklist?lat=&lng=&km= (km 1–50, default 10; optional user, for blocks)
func (a *Server) areaChecklist(w http.ResponseWriter, r *http.Request) {
	qs := r.URL.Query()
	lat, err1 := strconv.ParseFloat(qs.Get("lat"), 64)
	lng, err2 := strconv.ParseFloat(qs.Get("lng"), 64)
	if err1 != nil || err2 != nil || lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		writeError(w, http.StatusBadRequest, "lat and lng are required")
		return
	}
	km, err := strconv.Atoi(qs.Get("km"))
	if err != nil {
		km = 10
	}
	km = min(max(km, 1), 50)
	items, gbifOK, err := a.areaBirds(r.Context(), viewerID(r), lat, lng, km)
	if err != nil {
		internalError(w, "area checklist", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "km": km, "gbif_ok": gbifOK})
}

// areaBirds lists the (non-sensitive) birds recorded within km of a point, most recorded first, graded by rarity.
// Also scopes the "birds near me" quiz (QZ-04).
func (a *Server) areaBirds(ctx context.Context, viewer int64, lat, lng float64, km int) ([]areaBird, bool, error) {
	counts, gbifOK := a.gbifArea(ctx, lat, lng, km)
	keys, ns := make([]int64, 0, len(counts)), make([]int32, 0, len(counts))
	for k, n := range counts {
		if id, err := strconv.ParseInt(k, 10, 64); err == nil {
			keys, ns = append(keys, id), append(ns, int32(n))
		}
	}
	rows, err := a.db.Query(ctx, `
		WITH g AS (SELECT rs.species_id AS sid, sum(g.n)::int AS n
		           FROM unnest($4::bigint[], $5::int[]) AS g(key, n) JOIN region_species rs ON rs.gbif_key = g.key GROUP BY 1),
		     c AS (SELECT o.community_species_id AS sid, count(*)::int AS n, max(o.observed_at) AS last
		           FROM observations o
		           WHERE o.status IN ('community', 'verified') AND NOT o.hidden AND `+notBlocked("o.user_id")+`
		             AND ST_DWithin(o.location, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, $6 * 1000)
		           GROUP BY 1)
		SELECT s.id, s.english_name, s.scientific_name, s.family_sci, s.family_en, rs.species_id IS NOT NULL,
		       coalesce(g.n, 0), coalesce(c.n, 0), c.last, `+speciesImageColumns+`
		FROM species s
		LEFT JOIN g ON g.sid = s.id
		LEFT JOIN c ON c.sid = s.id
		LEFT JOIN region_species rs ON rs.species_id = s.id
		LEFT JOIN species_images si ON si.species_id = s.id AND si.status = 'ok'
		WHERE (g.sid IS NOT NULL OR c.sid IS NOT NULL) AND NOT s.sensitive AND NOT s.extinct AND s.merged_into IS NULL
		ORDER BY coalesce(g.n, 0) + coalesce(c.n, 0) DESC, s.seq
		LIMIT 1000`, viewer, lat, lng, keys, ns, km)
	if err != nil {
		return nil, false, err
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (areaBird, error) {
		var b areaBird
		var img imageDest
		err := row.Scan(append([]any{&b.ID, &b.EnglishName, &b.ScientificName, &b.FamilySci, &b.FamilyEn, &b.Local,
			&b.GBIF, &b.Community, &b.LastSeen}, img.targets()...)...)
		b.Image = a.image(img)
		return b, err
	})
	if err != nil {
		return nil, false, err
	}
	top := 0
	for _, b := range items {
		top = max(top, b.GBIF+b.Community)
	}
	for i := range items {
		items[i].Rarity = rarityOf(items[i].GBIF+items[i].Community, top)
	}
	return items, gbifOK, nil
}
