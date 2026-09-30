package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type speciesRef struct {
	ID             int64   `json:"id"`
	EnglishName    string  `json:"english_name"`
	ScientificName string  `json:"scientific_name"`
	ThumbURL       *string `json:"thumb_url"` // seeded species photo, if any
}

type observer struct {
	ID          int64   `json:"id"`
	DisplayName string  `json:"display_name"`
	AvatarURL   *string `json:"avatar_url"`
}

type observation struct {
	ID         int64       `json:"id"`
	Observer   observer    `json:"observer"`
	Species    *speciesRef `json:"species"` // nil = unknown
	ObservedAt time.Time   `json:"observed_at"`
	Lat        float64     `json:"lat"`
	Lng        float64     `json:"lng"`
	AccuracyM  *float64    `json:"accuracy_m"`
	Count      int         `json:"count"`
	Notes      string      `json:"notes"`
	Features   features    `json:"features"`
	Confidence string      `json:"confidence"` // certain | likely | guess | "" (unknown species)
	CreatedAt  time.Time   `json:"created_at"`
	Photos     []photo     `json:"photos"`
	Sounds     []sound     `json:"sounds"`
	Obscured   bool        `json:"obscured"` // lat/lng snapped to an ~11 km grid cell
	// VER-02: needs_id | community | verified, and the species the community settled on (nil until then).
	Status           string      `json:"status"`
	CommunitySpecies *speciesRef `json:"community_species"`
	Site             *site       `json:"site"`      // hidden when the location is obscured
	OutingID         *int64      `json:"outing_id"` // OBS-10
	Hidden           bool        `json:"hidden"`    // ADM-01: hidden by a moderator (only its observer and moderators see it)
	Unusual          string      `json:"unusual"`   // VER-08: "range" | "season" | ""
	Likes            int         `json:"likes"`     // COM-02
	Liked            bool        `json:"liked"`     // by the viewer
	cell             float64     // grid (degrees) to blur to: sensitive species (OBS-14/ADM-03) or observer hides locations (ACC-08); 0 = exact
}

const observationSelect = `
	SELECT o.id, s.id, s.english_name, s.scientific_name, o.observed_at,
	       ST_Y(o.location::geometry), ST_X(o.location::geometry), o.accuracy_m, o.count, o.notes, o.features, coalesce(o.confidence::text, ''), o.created_at,
	       si.thumb_key, u.id, u.display_name, u.avatar_key,
	       greatest(CASE WHEN s.sensitive THEN s.obscure_cell ELSE 0 END, CASE WHEN cs.sensitive THEN cs.obscure_cell ELSE 0 END,
	                CASE WHEN u.hide_locations THEN 0.1 ELSE 0 END)::float8,
	       o.status, cs.id, cs.english_name, cs.scientific_name,
	       st.id, st.name, ST_Y(st.location::geometry), ST_X(st.location::geometry), o.hidden, o.outing_id, o.unusual
	FROM observations o
	LEFT JOIN sites st ON st.id = o.site_id
	JOIN users u ON u.id = o.user_id
	LEFT JOIN species s ON s.id = o.species_id
	LEFT JOIN species cs ON cs.id = o.community_species_id
	LEFT JOIN species_images si ON si.species_id = s.id AND si.status = 'ok'`

func (a *Server) scanObservation(row pgx.Row) (observation, error) {
	var o observation
	var sid *int64
	var en, sci, thumb, avatar, csEn, csSci *string
	var csID, stID *int64
	var stName *string
	var stLat, stLng *float64
	err := row.Scan(&o.ID, &sid, &en, &sci, &o.ObservedAt, &o.Lat, &o.Lng, &o.AccuracyM, &o.Count, &o.Notes, &o.Features,
		&o.Confidence, &o.CreatedAt, &thumb, &o.Observer.ID, &o.Observer.DisplayName, &avatar, &o.cell,
		&o.Status, &csID, &csEn, &csSci, &stID, &stName, &stLat, &stLng, &o.Hidden, &o.OutingID, &o.Unusual)
	if stID != nil {
		o.Site = &site{ID: *stID, Name: *stName, Lat: *stLat, Lng: *stLng}
	}
	if csID != nil {
		o.CommunitySpecies = &speciesRef{ID: *csID, EnglishName: *csEn, ScientificName: *csSci}
	}
	if avatar != nil {
		u := a.media.URL(*avatar)
		o.Observer.AvatarURL = &u
	}
	if sid != nil {
		o.Species = &speciesRef{ID: *sid, EnglishName: *en, ScientificName: *sci}
		if thumb != nil {
			u := a.media.URL(*thumb)
			o.Species.ThumbURL = &u
		}
	}
	return o, err
}

// observationInput is the editable part of an observation, shared by create (OBS-01) and edit (OBS-11).
type observationInput struct {
	SpeciesID  *int64         `json:"species_id"`
	ObservedAt time.Time      `json:"observed_at"`
	Lat        *float64       `json:"lat"`
	Lng        *float64       `json:"lng"`
	AccuracyM  *float64       `json:"accuracy_m"`
	Count      *int           `json:"count"`
	Notes      string         `json:"notes"`
	Features   map[string]any `json:"features"`
	Confidence string         `json:"confidence"`
	SiteID     *int64         `json:"site_id"`   // OBS-04 named site (optional)
	ClientID   string         `json:"client_id"` // OBS-09 offline queue id; create only
	OutingID   *int64         `json:"outing_id"` // OBS-10: logged during this outing (the observer's own); create only
	feats      features
}

// readObservation decodes and validates the body, writing a 400/500 and returning false on failure.
func (a *Server) readObservation(w http.ResponseWriter, r *http.Request) (observationInput, bool) {
	var in observationInput
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body (observed_at must be RFC 3339)"})
		return in, false
	}
	in.Notes = strings.TrimSpace(in.Notes)
	if in.Count == nil {
		one := 1
		in.Count = &one
	}
	bad := func(msg string) (observationInput, bool) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
		return in, false
	}
	finite := func(f float64) bool { return !math.IsNaN(f) && !math.IsInf(f, 0) }
	switch {
	case in.Lat == nil || in.Lng == nil || !finite(*in.Lat) || !finite(*in.Lng) ||
		*in.Lat < -90 || *in.Lat > 90 || *in.Lng < -180 || *in.Lng > 180:
		return bad("a valid location (lat, lng) is required")
	case in.ObservedAt.IsZero():
		return bad("observed_at is required")
	case in.ObservedAt.After(time.Now().Add(10 * time.Minute)): // allow phone clock drift
		return bad("observed_at can't be in the future")
	case in.ObservedAt.Year() < 1900:
		return bad("observed_at is too far in the past")
	case *in.Count < 1 || *in.Count > 100000:
		return bad("count must be between 1 and 100000")
	case len([]rune(in.Notes)) > 2000:
		return bad("notes must be at most 2000 characters")
	case in.AccuracyM != nil && (!finite(*in.AccuracyM) || *in.AccuracyM < 0):
		return bad("accuracy_m must be a positive number")
	case in.SpeciesID == nil && in.Confidence != "":
		return bad("confidence only applies when a species is given")
	case in.Confidence != "" && in.Confidence != "certain" && in.Confidence != "likely" && in.Confidence != "guess":
		return bad("confidence must be certain, likely or guess")
	}
	var err error
	if in.feats, err = validateFeatures(in.Features); err != nil {
		return bad(err.Error())
	}
	if in.SiteID != nil {
		var near bool
		err := a.db.QueryRow(r.Context(), `SELECT ST_DWithin(location, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, 5000)
			FROM sites WHERE id = $1`, *in.SiteID, *in.Lat, *in.Lng).Scan(&near)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && !near) {
			return bad("site must exist and be within 5 km of the sighting")
		}
		if err != nil {
			internalError(w, "site check", err)
			return in, false
		}
	}
	if in.OutingID != nil {
		var mine bool
		if err := a.db.QueryRow(r.Context(), `SELECT user_id = $2 FROM outings WHERE id = $1`, *in.OutingID, userID(r)).Scan(&mine); err != nil || !mine {
			return bad("unknown outing")
		}
	}
	if in.SpeciesID != nil {
		var extinct bool
		err := a.db.QueryRow(r.Context(), `SELECT extinct OR merged_into IS NOT NULL FROM species WHERE id = $1`, *in.SpeciesID).Scan(&extinct)
		if errors.Is(err, pgx.ErrNoRows) || extinct {
			return bad("unknown species")
		}
		if err != nil {
			internalError(w, "species check", err)
			return in, false
		}
	}
	return in, true
}

// POST /observations — OBS-01.
func (a *Server) createObservation(w http.ResponseWriter, r *http.Request) {
	var accepted bool
	if err := a.db.QueryRow(r.Context(), `SELECT guidelines_accepted_at IS NOT NULL FROM users WHERE id = $1`, userID(r)).Scan(&accepted); err != nil {
		internalError(w, "guidelines check", err)
		return
	}
	if !accepted {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "please accept the community guidelines first", "code": "guidelines_required"})
		return
	}
	in, ok := a.readObservation(w, r)
	if !ok {
		return
	}
	if len(in.ClientID) > 64 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "client_id is too long"})
		return
	}
	if code, body := a.spamCheck(r, in); code != 0 {
		writeJSON(w, code, body)
		return
	}
	// OBS-09: a retried offline upload (same client_id) gets the sighting it already created, not a copy.
	var id int64
	status := http.StatusCreated
	err := a.db.QueryRow(r.Context(), `
		INSERT INTO observations (user_id, species_id, observed_at, location, accuracy_m, count, notes, features, confidence, site_id, client_id, outing_id)
		VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography, $6, $7, $8, $9, nullif($10, '')::id_confidence, $11, nullif($12, ''), $13)
		ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL DO NOTHING
		RETURNING id`,
		userID(r), in.SpeciesID, in.ObservedAt, *in.Lat, *in.Lng, in.AccuracyM, *in.Count, in.Notes, in.feats, in.Confidence, in.SiteID, in.ClientID, in.OutingID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		status = http.StatusOK
		err = a.db.QueryRow(r.Context(), `SELECT id FROM observations WHERE user_id = $1 AND client_id = $2`, userID(r), in.ClientID).Scan(&id)
	} else if err == nil {
		err = recompute(r.Context(), a.db, id)
	}
	if err != nil {
		internalError(w, "create observation", err)
		return
	}
	o, err := a.scanObservation(a.db.QueryRow(r.Context(), observationSelect+` WHERE o.id = $1`, id))
	if err != nil {
		internalError(w, "load observation", err)
		return
	}
	o.Photos, o.Sounds = []photo{}, []sound{} // ponytail: a repeat (200) doesn't list media it already has; the app only needs the id
	writeJSON(w, status, o)
}

// GET /me/observations?offset= — newest sighting first.
func (a *Server) myObservations(w http.ResponseWriter, r *http.Request) {
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	offset = max(offset, 0)
	const limit = 50
	rows, err := a.db.Query(r.Context(), observationSelect+`
		WHERE o.user_id = $1 ORDER BY o.observed_at DESC, o.id DESC LIMIT $2 OFFSET $3`, userID(r), limit+1, offset)
	if err != nil {
		internalError(w, "my observations", err)
		return
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (observation, error) { return a.scanObservation(row) })
	if err == nil {
		err = a.withPhotos(r.Context(), items)
	}
	if err != nil {
		internalError(w, "my observations", err)
		return
	}
	var total int
	if err := a.db.QueryRow(r.Context(), `SELECT count(*) FROM observations WHERE user_id = $1`, userID(r)).Scan(&total); err != nil {
		internalError(w, "count observations", err)
		return
	}
	resp := map[string]any{"items": items, "next_offset": nil, "total": total}
	if len(items) > limit {
		resp["items"], resp["next_offset"] = items[:limit], offset+limit
	}
	writeJSON(w, http.StatusOK, resp)
}

// snap returns the centre of the grid cell containing v.
func snap(v, cell float64) float64 {
	return math.Round((math.Floor(v/cell)*cell+cell/2)*1e4) / 1e4
}

// redact snaps coordinates to the grid for sensitive species (OBS-14) or observers who hide their
// locations (ACC-08), for anyone other than the observer and verifiers-and-up (who need exact
// locations to check range). The viewer's role is looked up at most once, and only when it matters.
func (a *Server) redact(ctx context.Context, obs []observation, viewerID int64) error {
	var checked, exact bool
	for i := range obs {
		o := &obs[i]
		if o.cell == 0 || (viewerID != 0 && viewerID == o.Observer.ID) {
			continue
		}
		if viewerID != 0 && !checked {
			checked = true
			var role string
			if err := a.db.QueryRow(ctx, `SELECT role FROM users WHERE id = $1`, viewerID).Scan(&role); err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
			exact = roleAtLeast(role, "verifier")
		}
		if !exact {
			o.Lat, o.Lng, o.AccuracyM, o.Obscured, o.Site = snap(o.Lat, o.cell), snap(o.Lng, o.cell), nil, true, nil
		}
	}
	return nil
}

// GET /observations/{id} — public; sensitive locations are obscured (OBS-14).
func (a *Server) getObservation(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	o, err := a.scanObservation(a.db.QueryRow(r.Context(), observationSelect+` WHERE o.id = $1 AND (NOT o.hidden OR o.user_id = $2
		OR (SELECT role >= 'moderator' FROM users WHERE id = $2))`, id, viewerID(r)))
	if errors.Is(err, pgx.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		internalError(w, "get observation", err)
		return
	}
	one := []observation{o}
	if err := a.redact(r.Context(), one, viewerID(r)); err != nil {
		internalError(w, "redact observation", err)
		return
	}
	if err := a.withPhotos(r.Context(), one); err != nil {
		internalError(w, "get observation photos", err)
		return
	}
	writeJSON(w, http.StatusOK, one[0])
}

// PUT /observations/{id} — OBS-11. Owner replaces the editable fields; changed fields are logged.
func (a *Server) updateObservation(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	in, ok := a.readObservation(w, r)
	if !ok {
		return
	}
	var o observation
	err = pgx.BeginFunc(r.Context(), a.db, func(tx pgx.Tx) error {
		cur, err := a.scanObservation(tx.QueryRow(r.Context(), observationSelect+` WHERE o.id = $1 AND o.user_id = $2 FOR UPDATE OF o`, id, userID(r)))
		if err != nil {
			return err
		}
		changes := map[string]any{}
		diff := func(field string, from, to any) {
			if fmt.Sprint(from) != fmt.Sprint(to) {
				changes[field] = map[string]any{"from": from, "to": to}
			}
		}
		var curSpecies, newSpecies any
		if cur.Species != nil {
			curSpecies = cur.Species.ID
		}
		if in.SpeciesID != nil {
			newSpecies = *in.SpeciesID
		}
		deref := func(p *float64) any {
			if p == nil {
				return nil
			}
			return *p
		}
		diff("species_id", curSpecies, newSpecies)
		diff("observed_at", cur.ObservedAt.UTC().Format(time.RFC3339), in.ObservedAt.UTC().Format(time.RFC3339))
		diff("lat", cur.Lat, *in.Lat)
		diff("lng", cur.Lng, *in.Lng)
		diff("accuracy_m", deref(cur.AccuracyM), deref(in.AccuracyM))
		diff("count", cur.Count, *in.Count)
		diff("notes", cur.Notes, in.Notes)
		diff("features", canonical(cur.Features), canonical(in.feats))
		diff("confidence", cur.Confidence, in.Confidence)
		var curSite, newSite any
		if cur.Site != nil {
			curSite = cur.Site.ID
		}
		if in.SiteID != nil {
			newSite = *in.SiteID
		}
		diff("site_id", curSite, newSite)

		if len(changes) > 0 {
			if _, err := tx.Exec(r.Context(), `
				UPDATE observations SET species_id = $2, observed_at = $3,
					location = ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography, accuracy_m = $6, count = $7,
					notes = $8, features = $9, confidence = nullif($10, '')::id_confidence, site_id = $11, updated_at = now()
				WHERE id = $1`,
				id, in.SpeciesID, in.ObservedAt, *in.Lat, *in.Lng, in.AccuracyM, *in.Count, in.Notes, in.feats, in.Confidence, in.SiteID); err != nil {
				return err
			}
			if _, err := tx.Exec(r.Context(), `INSERT INTO observation_edits (observation_id, changes) VALUES ($1, $2)`, id, changes); err != nil {
				return err
			}
			if err := recompute(r.Context(), tx, id); err != nil {
				return err
			}
		}
		o, err = a.scanObservation(tx.QueryRow(r.Context(), observationSelect+` WHERE o.id = $1`, id))
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		internalError(w, "update observation", err)
		return
	}
	one := []observation{o}
	if err := a.withPhotos(r.Context(), one); err != nil {
		internalError(w, "observation photos", err)
		return
	}
	writeJSON(w, http.StatusOK, one[0])
}

// canonical renders features with sorted keys so equal maps compare equal.
func canonical(f features) string {
	b, _ := json.Marshal(f) // encoding/json sorts map keys
	return string(b)
}

// DELETE /observations/{id} — owner; removes its photos from storage too.
func (a *Server) deleteObservation(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	rows, err := a.db.Query(r.Context(), `
		SELECT m.key, m.thumb_key FROM media m JOIN observations o ON o.id = m.observation_id
		WHERE o.id = $1 AND o.user_id = $2`, id, userID(r))
	if err != nil {
		internalError(w, "delete observation", err)
		return
	}
	var keys []string
	for rows.Next() {
		var k string
		var t *string
		if err := rows.Scan(&k, &t); err != nil {
			rows.Close()
			internalError(w, "delete observation", err)
			return
		}
		keys = append(keys, k)
		if t != nil {
			keys = append(keys, *t)
		}
	}
	rows.Close()
	tag, err := a.db.Exec(r.Context(), `DELETE FROM observations WHERE id = $1 AND user_id = $2`, id, userID(r))
	if err != nil {
		internalError(w, "delete observation", err)
		return
	}
	if tag.RowsAffected() == 0 {
		http.NotFound(w, r)
		return
	}
	for _, k := range keys {
		a.media.Remove(r.Context(), k)
	}
	w.WriteHeader(http.StatusNoContent)
}

// GET /observations/{id}/history — the observer and verifiers+ only (it can reveal exact locations).
func (a *Server) observationHistory(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	var owner int64
	var role string
	err = a.db.QueryRow(r.Context(), `
		SELECT o.user_id, (SELECT role::text FROM users WHERE id = $2) FROM observations o WHERE o.id = $1`, id, userID(r)).Scan(&owner, &role)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && owner != userID(r) && !roleAtLeast(role, "verifier")) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		internalError(w, "history", err)
		return
	}
	type edit struct {
		EditedAt time.Time      `json:"edited_at"`
		Changes  map[string]any `json:"changes"`
	}
	rows, err := a.db.Query(r.Context(), `SELECT edited_at, changes FROM observation_edits WHERE observation_id = $1 ORDER BY edited_at, id`, id)
	if err != nil {
		internalError(w, "history", err)
		return
	}
	edits, err := pgx.CollectRows(rows, pgx.RowToStructByPos[edit])
	if err != nil {
		internalError(w, "history", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": edits})
}
