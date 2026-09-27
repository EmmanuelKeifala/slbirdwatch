package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// speciesImage is a seeded Wikimedia photo (LIB-12) with the attribution its licence requires.
type speciesImage struct {
	URL        string `json:"url"`
	ThumbURL   string `json:"thumb_url"`
	Credit     string `json:"credit"`
	Licence    string `json:"licence"`
	LicenceURL string `json:"licence_url"`
	SourceURL  string `json:"source_url"`
}

// Columns for a LEFT JOIN species_images si ... AND si.status = 'ok'; scanned by imageDest.
const speciesImageColumns = `si.key, si.thumb_key, si.credit, si.licence, si.licence_url, si.source_url`

type imageDest struct{ key, thumb, credit, licence, licenceURL, source *string }

func (d *imageDest) targets() []any {
	return []any{&d.key, &d.thumb, &d.credit, &d.licence, &d.licenceURL, &d.source}
}

func (a *server) image(d imageDest) *speciesImage {
	if d.key == nil || d.thumb == nil {
		return nil
	}
	return &speciesImage{a.media.url(*d.key), a.media.url(*d.thumb), *d.credit, *d.licence, *d.licenceURL, *d.source}
}

// speciesSound is a seeded Xeno-canto recording (LIB-12b), always shown with its credit and licence.
type speciesSound struct {
	URL            string  `json:"url"`
	SpectrogramURL string  `json:"spectrogram_url"`
	DurationS      float64 `json:"duration_s"`
	Type           string  `json:"type"`
	Credit         string  `json:"credit"`
	Licence        string  `json:"licence"`
	LicenceURL     string  `json:"licence_url"`
	SourceURL      string  `json:"source_url"`
}

type speciesItem struct {
	ID             int64         `json:"id"`
	EnglishName    string        `json:"english_name"`
	ScientificName string        `json:"scientific_name"`
	FamilySci      string        `json:"family_sci"`
	FamilyEn       string        `json:"family_en"`
	Local          bool          `json:"local"` // recorded in Sierra Leone
	Image          *speciesImage `json:"image"`
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

// allowed reports whether v is a value of the given feature field (features.go vocabulary).
func allowed(field, v string) bool {
	for _, f := range featureFields {
		if f.Key == field {
			return slices.ContainsFunc(f.Options, func(o option) bool { return o.Value == v })
		}
	}
	return false
}

// GET /species?q=&family=&habitat=&size=&colour=&near=lat,lng&radius_km=&limit=&offset=
// Public (ACC-01). Extinct species are excluded. With q, results are ranked by name similarity (typo tolerant).
// LIB-03: habitat/size/colour match features birders recorded on community-ID or verified sightings;
// near= keeps species seen within radius_km (default 50) and never lists sensitive species.
func (a *server) listSpecies(w http.ResponseWriter, r *http.Request) {
	qs := r.URL.Query()
	q := strings.TrimSpace(qs.Get("q"))
	family := qs.Get("family")
	habitat, size, colour := qs.Get("habitat"), qs.Get("size"), qs.Get("colour")
	for field, v := range map[string]string{"habitat": habitat, "size": size, "colours": colour} {
		if v != "" && !allowed(field, v) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown " + field + " " + v})
			return
		}
	}
	var lat, lng *float64
	radius := 50.0
	if near := qs.Get("near"); near != "" {
		la, lo, ok := strings.Cut(near, ",")
		y, err1 := strconv.ParseFloat(la, 64)
		x, err2 := strconv.ParseFloat(lo, 64)
		if !ok || err1 != nil || err2 != nil || y < -90 || y > 90 || x < -180 || x > 180 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "near must be lat,lng"})
			return
		}
		lat, lng = &y, &x
		if rk, err := strconv.ParseFloat(qs.Get("radius_km"), 64); err == nil && rk > 0 {
			radius = min(rk, 500)
		}
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	offset = max(offset, 0)

	// ponytail: offset paging; switch to keyset on seq if deep paging gets slow.
	rows, err := a.db.Query(r.Context(), `
		SELECT s.id, s.english_name, s.scientific_name, s.family_sci, s.family_en, rs.species_id IS NOT NULL, `+speciesImageColumns+`
		FROM species s
		LEFT JOIN species_images si ON si.species_id = s.id AND si.status = 'ok'
		LEFT JOIN region_species rs ON rs.species_id = s.id
		WHERE NOT s.extinct AND s.merged_into IS NULL
		  AND ($1 = '' OR s.family_sci = $1)
		  AND ($2 = '' OR s.english_name ILIKE '%' || $2 || '%' OR s.scientific_name ILIKE '%' || $2 || '%'
		       OR $2 <% s.english_name OR $2 <% s.scientific_name
		       OR EXISTS (SELECT 1 FROM species_local_names n WHERE n.species_id = s.id
		                  AND (n.name ILIKE '%' || $2 || '%' OR $2 <% n.name)))
		  AND (($5 = '' AND $6 = '' AND $7 = '') OR EXISTS (
		        SELECT 1 FROM observations o
		        WHERE o.community_species_id = s.id AND o.status IN ('community', 'verified') AND NOT o.hidden
		          AND ($5 = '' OR o.features->>'habitat' = $5)
		          AND ($6 = '' OR o.features->>'size' = $6)
		          AND ($7 = '' OR o.features->'colours' ? $7)))
		  AND ($8::float8 IS NULL OR (NOT s.sensitive AND EXISTS (
		        SELECT 1 FROM observations o
		        WHERE o.community_species_id = s.id AND o.status IN ('community', 'verified') AND NOT o.hidden
		          AND ST_DWithin(o.location, ST_SetSRID(ST_MakePoint($9, $8), 4326)::geography, $10 * 1000))))
		-- Browsing (no search): Sierra Leone birds first, most recorded first; searching: best name match first.
		ORDER BY CASE WHEN $2 = '' THEN (rs.species_id IS NULL)::int ELSE 0 END,
		         CASE WHEN $2 = '' THEN -coalesce(rs.records, 0)
		              ELSE -greatest(word_similarity($2, s.english_name), word_similarity($2, s.scientific_name),
		                             coalesce((SELECT max(word_similarity($2, n.name)) FROM species_local_names n WHERE n.species_id = s.id), 0)) END,
		         s.seq
		LIMIT $3 OFFSET $4`, family, q, limit+1, offset, habitat, size, colour, lat, lng, radius)
	if err != nil {
		internalError(w, "list species", err)
		return
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (speciesItem, error) {
		var s speciesItem
		var img imageDest
		err := row.Scan(append([]any{&s.ID, &s.EnglishName, &s.ScientificName, &s.FamilySci, &s.FamilyEn, &s.Local}, img.targets()...)...)
		s.Image = a.image(img)
		return s, err
	})
	if err != nil {
		internalError(w, "list species", err)
		return
	}

	resp := map[string]any{"items": items, "next_offset": nil}
	if len(items) > limit {
		resp["items"], resp["next_offset"] = items[:limit], offset+limit
	}
	writeJSON(w, http.StatusOK, resp)
}

type speciesDetail struct {
	ID               int64          `json:"id"`
	EnglishName      string         `json:"english_name"`
	ScientificName   string         `json:"scientific_name"`
	OrderName        string         `json:"order_name"`
	FamilySci        string         `json:"family_sci"`
	FamilyEn         string         `json:"family_en"`
	Authority        string         `json:"authority"`
	BreedingRange    string         `json:"breeding_range"`
	NonbreedingRange string         `json:"nonbreeding_range"`
	Extinct          bool           `json:"extinct"`
	Image            *speciesImage  `json:"image"`
	Sound            *speciesSound  `json:"sound"`
	Details          *speciesText   `json:"details"` // Sierra Leone species with a Wikipedia article
	Region           *regionInfo    `json:"region"`  // recorded in Sierra Leone (GBIF)
	Gallery          []galleryPhoto `json:"gallery"` // LIB-08 reference photos (iNaturalist), may be empty
	Sounds           []gallerySound `json:"sounds"`  // LIB-09 recordings (Xeno-canto) by kind, may be empty
	LocalNames       []localName    `json:"local_names"`
	Mnemonic         string         `json:"mnemonic"`    // LRN-08: a memory phrase for its song or call
	Sensitive        bool           `json:"sensitive"`   // ADM-03: other people see its sightings blurred
	ObscureKm        int            `json:"obscure_km"`  // how far, roughly
	MergedInto       *speciesRef    `json:"merged_into"` // ADM-02: retired, now part of this species
	SplitInto        []speciesRef   `json:"split_into"`  // ADM-02: split into these species
}

type gallerySound struct {
	URL            string  `json:"url"`
	SpectrogramURL string  `json:"spectrogram_url"`
	DurationS      float64 `json:"duration_s"`
	Kind           string  `json:"kind"` // song | call | alarm | flight
	Type           string  `json:"type"` // the recordist's own words
	Sex            string  `json:"sex"`
	Country        string  `json:"country"`
	Month          *int    `json:"month"`
	Season         string  `json:"season"` // rainy | dry, only for West African recordings
	Credit         string  `json:"credit"`
	Licence        string  `json:"licence"`
	LicenceURL     string  `json:"licence_url"`
	SourceURL      string  `json:"source_url"`
}

type galleryPhoto struct {
	ID         int64       `json:"id"`
	Reference  bool        `json:"reference"` // VER-07: a verifier's pick
	URL        string      `json:"url"`
	ThumbURL   string      `json:"thumb_url"`
	Width      int         `json:"width"`
	Height     int         `json:"height"`
	Variant    string      `json:"variant"` // male | female | juvenile | adult | ""
	Tags       []string    `json:"tags"`    // LIB-08: variant plus breeding / non-breeding / in-flight
	Marks      []photoMark `json:"marks"`   // LRN-03, reference photos
	Month      *int        `json:"month"`   // 1–12, when photographed
	Credit     string      `json:"credit"`
	Licence    string      `json:"licence"`
	LicenceURL string      `json:"licence_url"`
	SourceURL  string      `json:"source_url"`
}

// speciesText is Wikipedia article text (CC BY-SA 4.0): show it with a link to SourceURL.
type speciesText struct {
	Sections   []textSection `json:"sections"`
	Highlights []textSection `json:"highlights"`
	Length     string        `json:"length"`
	IUCN       string        `json:"iucn"`
	SourceURL  string        `json:"source_url"`
	Licence    string        `json:"licence"`
}

type regionInfo struct {
	GBIFKey *int64 `json:"gbif_key"` // for GBIF's range map tiles
	Records int    `json:"records"`
	Months  []int  `json:"months"` // GBIF records per month, Jan..Dec
}

// GET /species/{id} — public species page data (LIB-01 grows from here).
func (a *server) getSpecies(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if bearer(r) == "" && a.cache != nil { // ADM-06: anonymous library visits, per day
		key := "visits:anon:" + time.Now().UTC().Format("2006-01-02")
		a.cache.Incr(r.Context(), key)
		a.cache.Expire(r.Context(), key, 400*24*time.Hour)
	}
	sp, err := a.loadSpeciesDetail(r.Context(), id)
	if err != nil {
		internalError(w, "get species", err)
		return
	}
	if sp == nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=300")
	writeJSON(w, http.StatusOK, sp)
}

// loadSpeciesDetail is everything on a species page (nil when there's no such species). Also builds the
// offline pack (LIB-11).
func (a *server) loadSpeciesDetail(ctx context.Context, id int64) (*speciesDetail, error) {
	var sp speciesDetail
	var img imageDest
	var sndKey, sndSpec *string
	var sndMS int
	var snd speciesSound
	var cell float64
	err := a.db.QueryRow(ctx, `
		SELECT s.id, s.english_name, s.scientific_name, s.order_name, s.family_sci, s.family_en, s.authority,
		       s.breeding_range, s.nonbreeding_range, s.extinct, s.sensitive, s.obscure_cell::float8, `+speciesImageColumns+`,
		       ss.key, ss.spec_key, coalesce(ss.duration_ms, 0), coalesce(ss.call_type, ''), coalesce(ss.credit, ''),
		       coalesce(ss.licence, ''), coalesce(ss.licence_url, ''), coalesce(ss.source_url, '')
		FROM species s
		LEFT JOIN species_images si ON si.species_id = s.id AND si.status = 'ok'
		LEFT JOIN species_sounds ss ON ss.species_id = s.id AND ss.status = 'ok'
		WHERE s.id = $1`, id).
		Scan(append(append([]any{&sp.ID, &sp.EnglishName, &sp.ScientificName, &sp.OrderName, &sp.FamilySci, &sp.FamilyEn,
			&sp.Authority, &sp.BreedingRange, &sp.NonbreedingRange, &sp.Extinct, &sp.Sensitive, &cell}, img.targets()...),
			&sndKey, &sndSpec, &sndMS, &snd.Type, &snd.Credit, &snd.Licence, &snd.LicenceURL, &snd.SourceURL)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get species: %w", err)
	}
	sp.Image = a.image(img)
	sp.ObscureKm = cellKm(cell)
	if sndKey != nil && sndSpec != nil {
		snd.URL, snd.SpectrogramURL, snd.DurationS = a.media.url(*sndKey), a.media.url(*sndSpec), float64(sndMS)/1000
		sp.Sound = &snd
	}
	var text speciesText
	var hasText bool
	var region regionInfo
	err = a.db.QueryRow(ctx, `
		SELECT coalesce(d.status = 'ok', false), coalesce(d.sections, '[]'), coalesce(d.highlights, '[]'), coalesce(d.length_text, ''),
		       coalesce(d.iucn, ''), coalesce(d.source_url, ''), coalesce(rs.records, 0), coalesce(rs.months, '{}'), rs.gbif_key,
		       coalesce((SELECT text FROM species_mnemonics m WHERE m.species_id = s.id), '')
		FROM species s
		LEFT JOIN species_details d ON d.species_id = s.id
		LEFT JOIN region_species rs ON rs.species_id = s.id
		WHERE s.id = $1`, id).
		Scan(&hasText, &text.Sections, &text.Highlights, &text.Length, &text.IUCN, &text.SourceURL, &region.Records, &region.Months, &region.GBIFKey, &sp.Mnemonic)
	if err != nil {
		return nil, fmt.Errorf("get species details: %w", err)
	}
	if hasText {
		text.Licence = "CC BY-SA 4.0"
		sp.Details = &text
	}
	if region.Records > 0 {
		sp.Region = &region
	}
	rows, err := a.db.Query(ctx, `
		SELECT id, reference, key, thumb_key, width, height, variant, month, credit, licence, licence_url, source_url, tags
		FROM species_gallery WHERE species_id = $1
		ORDER BY reference DESC, array_position(ARRAY['male', 'female', 'juvenile'], variant) NULLS LAST, id`, id)
	if err != nil {
		return nil, fmt.Errorf("species gallery: %w", err)
	}
	sp.Gallery, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (galleryPhoto, error) {
		var g galleryPhoto
		var month *int16
		err := row.Scan(&g.ID, &g.Reference, &g.URL, &g.ThumbURL, &g.Width, &g.Height, &g.Variant, &month, &g.Credit, &g.Licence, &g.LicenceURL, &g.SourceURL, &g.Tags)
		g.URL, g.ThumbURL = a.media.url(g.URL), a.media.url(g.ThumbURL)
		if month != nil {
			m := int(*month)
			g.Month = &m
		}
		return g, err
	})
	if err != nil {
		return nil, fmt.Errorf("species gallery: %w", err)
	}
	refs := make([]string, len(sp.Gallery))
	for i, g := range sp.Gallery {
		refs[i] = "gallery:" + strconv.FormatInt(g.ID, 10)
	}
	marks, err := marksFor(ctx, a.db, refs)
	if err != nil {
		return nil, fmt.Errorf("field marks: %w", err)
	}
	for i := range sp.Gallery {
		sp.Gallery[i].Marks = append([]photoMark{}, marks[refs[i]]...)
	}
	if ref, err := a.referenceImage(ctx, id); err != nil { // VER-07: a verifier's pick leads the page
		return nil, fmt.Errorf("reference photo: %w", err)
	} else if ref != nil {
		sp.Image = ref
	}
	rows, err = a.db.Query(ctx, `
		SELECT key, spec_key, duration_ms, kind, call_type, sex, country, month, credit, licence, licence_url, source_url
		FROM species_sound_gallery WHERE species_id = $1
		ORDER BY array_position(ARRAY['song', 'call', 'alarm', 'flight'], kind), id`, id)
	if err != nil {
		return nil, fmt.Errorf("species sounds: %w", err)
	}
	sp.Sounds, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (gallerySound, error) {
		var g gallerySound
		var ms int
		var month *int16
		err := row.Scan(&g.URL, &g.SpectrogramURL, &ms, &g.Kind, &g.Type, &g.Sex, &g.Country, &month, &g.Credit, &g.Licence, &g.LicenceURL, &g.SourceURL)
		g.URL, g.SpectrogramURL, g.DurationS = a.media.url(g.URL), a.media.url(g.SpectrogramURL), float64(ms)/1000
		if month != nil {
			m := int(*month)
			g.Month = &m
			if slices.Contains(westAfrica, g.Country) {
				g.Season = map[bool]string{true: "rainy", false: "dry"}[wetSeason(m)]
			}
		}
		return g, err
	})
	if err != nil {
		return nil, fmt.Errorf("species sounds: %w", err)
	}
	if sp.LocalNames, err = a.localNames(ctx, id); err != nil {
		return nil, fmt.Errorf("local names: %w", err)
	}
	rows, err = a.db.Query(ctx, `
		SELECT t.id, t.english_name, t.scientific_name, coalesce(t.id = s.merged_into, false)
		FROM species s JOIN species t ON t.id = s.merged_into OR t.id = ANY(s.split_into)
		WHERE s.id = $1 ORDER BY t.seq`, id)
	if err != nil {
		return nil, fmt.Errorf("taxonomy links: %w", err)
	}
	sp.SplitInto = []speciesRef{}
	for rows.Next() {
		var ref speciesRef
		var merged bool
		if err := rows.Scan(&ref.ID, &ref.EnglishName, &ref.ScientificName, &merged); err != nil {
			rows.Close()
			return nil, fmt.Errorf("taxonomy links: %w", err)
		}
		if merged {
			sp.MergedInto = &ref
		} else {
			sp.SplitInto = append(sp.SplitInto, ref)
		}
	}
	rows.Close()
	return &sp, nil
}

type communityPhoto struct {
	photo
	ObservationID int64  `json:"observation_id"`
	Credit        string `json:"credit"`
}

// GET /species/{id}/photos?offset= — LIB-02: photos from verified sightings of this species, credited to the observer.
func (a *server) speciesPhotos(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	offset = max(offset, 0)
	const limit = 30
	rows, err := a.db.Query(r.Context(), `
		SELECT m.id, m.key, m.thumb_key, m.width, m.height, m.licence, m.quiz_suitable, m.reference, o.id, u.display_name, m.tags
		FROM media m
		JOIN observations o ON o.id = m.observation_id
		JOIN users u ON u.id = o.user_id
		WHERE o.status = 'verified' AND NOT o.hidden AND o.community_species_id = $1 AND m.kind = 'photo'
		ORDER BY m.reference DESC, m.id DESC LIMIT $2 OFFSET $3`, id, limit+1, offset)
	if err != nil {
		internalError(w, "species photos", err)
		return
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (communityPhoto, error) {
		var p communityPhoto
		var key, thumb string
		err := row.Scan(&p.ID, &key, &thumb, &p.Width, &p.Height, &p.Licence, &p.QuizOK, &p.Reference, &p.ObservationID, &p.Credit, &p.Tags)
		p.URL, p.ThumbURL = a.media.url(key), a.media.url(thumb)
		return p, err
	})
	if err != nil {
		internalError(w, "species photos", err)
		return
	}
	resp := map[string]any{"items": items, "next_offset": nil}
	if len(items) > limit {
		resp["items"], resp["next_offset"] = items[:limit], offset+limit
	}
	writeJSON(w, http.StatusOK, resp)
}

type family struct {
	FamilySci string `json:"family_sci"`
	FamilyEn  string `json:"family_en"`
	Species   int    `json:"species"`
}

// GET /families — every family with its number of living species, in taxonomic order (LIB-03 browse).
func (a *server) listFamilies(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.Query(r.Context(), `
		SELECT family_sci, min(family_en), count(*)::int FROM species WHERE NOT extinct AND merged_into IS NULL
		GROUP BY family_sci ORDER BY min(seq)`)
	if err != nil {
		internalError(w, "families", err)
		return
	}
	items, err := pgx.CollectRows(rows, pgx.RowToStructByPos[family])
	if err != nil {
		internalError(w, "families", err)
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=3600")
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

type pickItem struct {
	speciesItem
	Hint string `json:"hint"` // recent | likely | region | ""
}

// GET /species/pick?q=&month= — the species picker (OBS-06). Public; signed-in viewers get their own
// recently recorded species first, then species recorded in Sierra Leone around `month` (the sighting's month,
// 1–12, default now), then the rest of Sierra Leone, then the world. q matches common, local and scientific
// names, typo tolerant. Without q only recent and Sierra Leone species are listed.
func (a *server) pickSpecies(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	month, err := strconv.Atoi(r.URL.Query().Get("month"))
	if err != nil || month < 1 || month > 12 {
		month = int(time.Now().Month())
	}
	prev, next := (month+10)%12+1, month%12+1
	// ponytail: "likely" = any GBIF record within a month either side (or too few records to judge);
	// weigh by observer effort per month if dry-season bias starts misleading the ranking.
	rows, err := a.db.Query(r.Context(), `
		WITH mine AS (
			SELECT coalesce(species_id, community_species_id) AS species_id, max(observed_at) AS last
			FROM observations WHERE user_id = $1 AND coalesce(species_id, community_species_id) IS NOT NULL
			GROUP BY 1),
		ranked AS (
			SELECT s.*, m.last,
			       coalesce(rs.months[$3] + rs.months[$4] + rs.months[$5], 0) AS now_records,
			       CASE WHEN m.species_id IS NOT NULL THEN 'recent'
			            WHEN rs.records < 5 OR rs.months[$3] + rs.months[$4] + rs.months[$5] > 0 THEN 'likely'
			            WHEN rs.species_id IS NOT NULL THEN 'region' ELSE '' END AS hint,
			       CASE WHEN $2 = '' THEN 0 ELSE greatest(word_similarity($2, s.english_name), word_similarity($2, s.scientific_name),
			            (SELECT max(word_similarity($2, n.name)) FROM species_local_names n WHERE n.species_id = s.id)) END AS sim
			FROM species s
			LEFT JOIN mine m ON m.species_id = s.id
			LEFT JOIN region_species rs ON rs.species_id = s.id
			WHERE NOT s.extinct AND s.merged_into IS NULL AND CASE WHEN $2 = '' THEN m.species_id IS NOT NULL OR rs.species_id IS NOT NULL
			      ELSE s.english_name ILIKE '%' || $2 || '%' OR s.scientific_name ILIKE '%' || $2 || '%'
			           OR $2 <% s.english_name OR $2 <% s.scientific_name
			           OR EXISTS (SELECT 1 FROM species_local_names n WHERE n.species_id = s.id
			                      AND (n.name ILIKE '%' || $2 || '%' OR $2 <% n.name)) END)
		SELECT s.id, s.english_name, s.scientific_name, s.family_sci, s.family_en, s.hint, `+speciesImageColumns+`
		FROM ranked s
		LEFT JOIN species_images si ON si.species_id = s.id AND si.status = 'ok'
		ORDER BY s.sim > 0.9 DESC, -- the name typed in full wins wherever the bird lives
		         array_position(ARRAY['recent', 'likely', 'region', ''], s.hint), s.sim DESC, s.last DESC NULLS LAST,
		         s.now_records DESC, s.seq
		LIMIT 20`, viewerID(r), q, month, prev, next)
	if err != nil {
		internalError(w, "pick species", err)
		return
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (pickItem, error) {
		var p pickItem
		var img imageDest
		err := row.Scan(append([]any{&p.ID, &p.EnglishName, &p.ScientificName, &p.FamilySci, &p.FamilyEn, &p.Hint}, img.targets()...)...)
		p.Image = a.image(img)
		return p, err
	})
	if err != nil {
		internalError(w, "pick species", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "month": month})
}
