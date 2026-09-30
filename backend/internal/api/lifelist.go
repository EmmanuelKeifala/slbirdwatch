package api

import (
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
)

// LRN-05 life list: the species on your verified sightings, and birds to learn next.

type lifeBird struct {
	ID          int64     `json:"id"`
	EnglishName string    `json:"english_name"`
	Scientific  string    `json:"scientific_name"`
	ThumbURL    *string   `json:"thumb_url"`
	FirstSeen   time.Time `json:"first_seen"`
	Sightings   int       `json:"sightings"`
	Verified    bool      `json:"verified"` // false = only on sightings still awaiting confirmation
}

// GET /me/lifelist — verified species first (by first seen, newest first), then ones awaiting confirmation.
func (a *Server) lifeList(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.Query(r.Context(), `
		SELECT s.id, s.english_name, s.scientific_name, coalesce(si.thumb_key, g.thumb_key),
		       min(o.observed_at), count(*)::int, bool_or(o.status = 'verified')
		FROM observations o
		JOIN species s ON s.id = coalesce(o.community_species_id, o.species_id)
		LEFT JOIN species_images si ON si.species_id = s.id AND si.status = 'ok'
		LEFT JOIN LATERAL (SELECT thumb_key FROM species_gallery WHERE species_id = s.id ORDER BY reference DESC, id LIMIT 1) g ON true
		WHERE o.user_id = $1 AND NOT o.hidden
		GROUP BY s.id, si.thumb_key, g.thumb_key
		ORDER BY bool_or(o.status = 'verified') DESC, min(o.observed_at) DESC`, userID(r))
	if err != nil {
		internalError(w, "life list", err)
		return
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (lifeBird, error) {
		var b lifeBird
		var thumb *string
		err := row.Scan(&b.ID, &b.EnglishName, &b.Scientific, &thumb, &b.FirstSeen, &b.Sightings, &b.Verified)
		b.ThumbURL = a.mediaURL(thumb)
		return b, err
	})
	if err != nil {
		internalError(w, "life list", err)
		return
	}
	verified := 0
	for _, b := range items {
		if b.Verified {
			verified++
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "verified": verified})
}

// GET /me/learn-next — up to 12 Sierra Leone birds you haven't recorded: those the community recorded in the
// last 30 days first ("out there now"), then the most recorded overall.
func (a *Server) learnNext(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.Query(r.Context(), `
		WITH mine AS (SELECT DISTINCT coalesce(community_species_id, species_id) AS id FROM observations WHERE user_id = $1),
		recent AS (SELECT DISTINCT coalesce(community_species_id, species_id) AS id FROM observations
		           WHERE NOT hidden AND observed_at > now() - interval '30 days'
		             AND coalesce(community_species_id, species_id) IS NOT NULL) -- a NULL here would make IN yield NULL
		SELECT s.id, s.english_name, s.scientific_name, coalesce(si.thumb_key, g.thumb_key), s.id IN (SELECT id FROM recent)
		FROM region_species rs JOIN species s ON s.id = rs.species_id
		LEFT JOIN species_images si ON si.species_id = s.id AND si.status = 'ok'
		LEFT JOIN LATERAL (SELECT thumb_key FROM species_gallery WHERE species_id = s.id ORDER BY reference DESC, id LIMIT 1) g ON true
		WHERE s.id NOT IN (SELECT id FROM mine WHERE id IS NOT NULL) AND NOT s.extinct AND s.merged_into IS NULL AND NOT s.sensitive
		ORDER BY s.id IN (SELECT id FROM recent) DESC, rs.records DESC LIMIT 12`, userID(r))
	if err != nil {
		internalError(w, "learn next", err)
		return
	}
	type next struct {
		ID          int64   `json:"id"`
		EnglishName string  `json:"english_name"`
		Scientific  string  `json:"scientific_name"`
		ThumbURL    *string `json:"thumb_url"`
		OutThereNow bool    `json:"out_there_now"`
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (next, error) {
		var n next
		var thumb *string
		err := row.Scan(&n.ID, &n.EnglishName, &n.Scientific, &thumb, &n.OutThereNow)
		n.ThumbURL = a.mediaURL(thumb)
		return n, err
	})
	if err != nil {
		internalError(w, "learn next", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}
