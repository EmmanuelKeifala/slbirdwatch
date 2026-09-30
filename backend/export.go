package main

import (
	"crypto/rand"
	"encoding/csv"
	"encoding/hex"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// ADM-07: verified sightings for research partners as Darwin Core occurrence CSV. Admins get a one-time link
// (10 minutes, Redis) so the file downloads in any browser. Obscuring holds: sensitive species and observers
// who hide locations get snapped coordinates with a matching uncertainty; private observers are anonymous;
// "all rights reserved" media is never linked; each record carries the observer's licence.

var licenceURLs = map[string]string{
	"cc0":      "http://creativecommons.org/publicdomain/zero/1.0/legalcode",
	"cc-by":    "http://creativecommons.org/licenses/by/4.0/legalcode",
	"cc-by-nc": "http://creativecommons.org/licenses/by-nc/4.0/legalcode",
}

// POST /admin/export-link → {url}: a one-time download link for GET /export/occurrences.csv.
func (a *server) exportLink(w http.ResponseWriter, r *http.Request) {
	b := make([]byte, 24)
	rand.Read(b)
	tok := hex.EncodeToString(b)
	if err := a.cache.Set(r.Context(), "export:"+tok, userID(r), 10*time.Minute).Err(); err != nil {
		internalError(w, "export link", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"url": absolute(r, "/export/occurrences.csv?token="+tok)})
}

// GET /export/occurrences.csv?token= (one-time)
func (a *server) exportCSV(w http.ResponseWriter, r *http.Request) {
	tok := r.URL.Query().Get("token")
	if tok == "" || a.cache.GetDel(r.Context(), "export:"+tok).Err() != nil {
		http.Error(w, "This download link has expired. Make a new one in the app.", http.StatusForbidden)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="slbirdwatch-occurrences-%s.csv"`, time.Now().UTC().Format("2006-01-02")))
	cw := csv.NewWriter(w)
	cw.Write(dwcColumns)
	if err := a.occurrences(r, false, func(rec []string) { cw.Write(rec) }); err != nil {
		log.Printf("export: %v", err) // headers are gone; a short file is the best we can do
	}
	cw.Flush()
}

// Darwin Core columns, in order, for the CSV export (ADM-07) and the GBIF archive (ADM-08).
var dwcColumns = []string{"occurrenceID", "basisOfRecord", "eventDate", "scientificName", "vernacularName", "family", "taxonRank",
	"individualCount", "decimalLatitude", "decimalLongitude", "coordinateUncertaintyInMeters", "geodeticDatum", "countryCode",
	"recordedBy", "identificationVerificationStatus", "license", "rightsHolder", "institutionCode", "datasetName", "modified", "associatedMedia"}

// occurrences emits every verified, non-hidden sighting as a Darwin Core row, obscured and anonymised as needed.
// openOnly keeps records under open licences GBIF accepts (CC0, CC BY, CC BY-NC).
func (a *server) occurrences(r *http.Request, openOnly bool, emit func([]string)) error {
	rows, err := a.db.Query(r.Context(), `
		SELECT o.id, o.observed_at, s.scientific_name, s.english_name, s.family_sci, o.count,
		       ST_Y(o.location::geometry), ST_X(o.location::geometry), o.accuracy_m,
		       greatest(CASE WHEN s.sensitive THEN s.obscure_cell ELSE 0 END, CASE WHEN u.hide_locations THEN 0.1 ELSE 0 END)::float8,
		       CASE WHEN u.private_profile THEN 'SL Birdwatch observer ' || u.id ELSE u.display_name END,
		       u.default_licence::text, o.updated_at,
		       coalesce((SELECT string_agg(m.key, ' ' ORDER BY m.id) FROM media m WHERE m.observation_id = o.id AND m.licence <> 'all-rights-reserved'), '')
		FROM observations o JOIN species s ON s.id = o.community_species_id JOIN users u ON u.id = o.user_id
		WHERE o.status = 'verified' AND NOT o.hidden AND (NOT $1 OR u.default_licence <> 'all-rights-reserved')
		ORDER BY o.observed_at`, openOnly)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var at, modified time.Time
		var sci, en, fam, rec, licence, keys string
		var count int
		var lat, lng, cell float64
		var acc *float64
		if err := rows.Scan(&id, &at, &sci, &en, &fam, &count, &lat, &lng, &acc, &cell, &rec, &licence, &modified, &keys); err != nil {
			return err
		}
		unc := ""
		if acc != nil {
			unc = strconv.Itoa(int(*acc))
		}
		if cell > 0 { // blurred: centre of the grid cell, uncertainty to its corner (1° ≈ 111 km)
			lat, lng = snap(lat, cell), snap(lng, cell)
			unc = strconv.Itoa(int(cell * 111000 * 0.71))
		}
		country := ""
		if inSierraLeone(lat, lng) {
			country = "SL"
		}
		var media []string
		for _, k := range strings.Fields(keys) {
			media = append(media, absolute(r, a.media.url(k)))
		}
		lic := licenceURLs[licence]
		if lic == "" {
			lic = "All rights reserved"
		}
		emit([]string{"slbirdwatch:" + strconv.FormatInt(id, 10), "HumanObservation", at.UTC().Format(time.RFC3339), sci, en, fam, "species",
			strconv.Itoa(count), strconv.FormatFloat(lat, 'f', 5, 64), strconv.FormatFloat(lng, 'f', 5, 64), unc, "WGS84", country,
			rec, "verified", lic, rec, "SLBirdwatch", "SL Birdwatch verified sightings", modified.UTC().Format(time.RFC3339), strings.Join(media, " | ")})
	}
	return rows.Err()
}
