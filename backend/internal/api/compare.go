package api

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

// LIB-07 similar species and LRN-01 side-by-side comparison.

type similarSpecies struct {
	ID             int64   `json:"id"`
	EnglishName    string  `json:"english_name"`
	ScientificName string  `json:"scientific_name"`
	ThumbURL       *string `json:"thumb_url"`
	Local          bool    `json:"local"`
	Reason         string  `json:"reason"` // confused | genus | family
}

// GET /species/{id}/similar — up to 8 lookalikes: species the community has actually mixed up with this one
// (different IDs on the same sighting), then the same genus, then the same family; Sierra Leone birds first.
func (a *Server) similarSpecies(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	rows, err := a.db.Query(r.Context(), `
		WITH me AS (SELECT genus, family_sci FROM species WHERE id = $1),
		ids AS ( -- every species put forward for a sighting: the observer's, the community's, each identification
			SELECT o.id AS obs, o.species_id AS sp FROM observations o WHERE NOT o.hidden AND o.species_id IS NOT NULL
			UNION SELECT o.id, o.community_species_id FROM observations o WHERE NOT o.hidden AND o.community_species_id IS NOT NULL
			UNION SELECT i.observation_id, i.species_id FROM identifications i WHERE i.is_current),
		confused AS (
			SELECT b.sp AS species_id, count(DISTINCT a.obs) AS n FROM ids a JOIN ids b ON b.obs = a.obs AND b.sp <> a.sp
			WHERE a.sp = $1 GROUP BY b.sp)
		SELECT s.id, s.english_name, s.scientific_name, coalesce(si.thumb_key, g.thumb_key), rs.species_id IS NOT NULL,
		       CASE WHEN c.n IS NOT NULL THEN 'confused' WHEN s.genus = me.genus THEN 'genus' ELSE 'family' END AS reason
		FROM species s CROSS JOIN me
		LEFT JOIN confused c ON c.species_id = s.id
		LEFT JOIN region_species rs ON rs.species_id = s.id
		LEFT JOIN species_images si ON si.species_id = s.id AND si.status = 'ok'
		LEFT JOIN LATERAL (SELECT thumb_key FROM species_gallery WHERE species_id = s.id ORDER BY id LIMIT 1) g ON true
		WHERE s.id <> $1 AND NOT s.extinct AND s.merged_into IS NULL
		  AND (c.n IS NOT NULL OR s.genus = me.genus OR s.family_sci = me.family_sci)
		ORDER BY (c.n IS NULL), -coalesce(c.n, 0), (s.genus <> me.genus), (rs.species_id IS NULL), -coalesce(rs.records, 0), s.seq
		LIMIT 8`, id)
	if err != nil {
		internalError(w, "similar species", err)
		return
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (similarSpecies, error) {
		var s similarSpecies
		var thumb *string
		err := row.Scan(&s.ID, &s.EnglishName, &s.ScientificName, &thumb, &s.Local, &s.Reason)
		s.ThumbURL = a.mediaURL(thumb)
		return s, err
	})
	if err != nil {
		internalError(w, "similar species", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// Field marks compared side by side: feature keys from the sighting form (features.go).
var compareKeys = []string{"size", "colours", "bill", "markings", "habitat"}

type fieldMark struct {
	Key    string `json:"key"`
	Label  string `json:"label"`  // e.g. "White"
	Count  int    `json:"count"`  // sightings noting it
	Unique bool   `json:"unique"` // no other compared species has it: a difference to look for
}

type compareItem struct {
	ID             int64          `json:"id"`
	EnglishName    string         `json:"english_name"`
	ScientificName string         `json:"scientific_name"`
	FamilyEn       string         `json:"family_en"`
	Image          *string        `json:"image"`    // hero photo
	Variants       []galleryPhoto `json:"variants"` // one male, one female, one young where available
	Sound          *gallerySound  `json:"sound"`    // a song, else a call
	Length         string         `json:"length"`
	Months         []int          `json:"months"` // GBIF records in Sierra Leone per month, nil if not recorded there
	Sexes          string         `json:"sexes"`  // "Males and females" text
	Voice          string         `json:"voice"`
	Marks          []fieldMark    `json:"marks"`
	Sightings      int            `json:"sightings"` // confirmed sightings the marks come from
}

// GET /compare?ids=1,2,3 — 2 to 4 species side by side (LRN-01). Marks only one species shows are flagged.
func (a *Server) compare(w http.ResponseWriter, r *http.Request) {
	var ids []int64
	for s := range strings.SplitSeq(r.URL.Query().Get("ids"), ",") {
		if id, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64); err == nil && !slices.Contains(ids, id) {
			ids = append(ids, id)
		}
	}
	if len(ids) < 2 || len(ids) > 4 {
		writeError(w, http.StatusBadRequest, "compare 2 to 4 species")
		return
	}
	items := make([]compareItem, 0, len(ids))
	for _, id := range ids {
		it, err := a.compareOne(r.Context(), id)
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusBadRequest, "unknown species "+strconv.FormatInt(id, 10))
			return
		}
		if err != nil {
			internalError(w, "compare", err)
			return
		}
		items = append(items, it)
	}
	flagUniqueMarks(items)
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// flagUniqueMarks marks each field mark no other compared species shows.
func flagUniqueMarks(items []compareItem) {
	seen := map[string]int{}
	for _, it := range items {
		for _, m := range it.Marks {
			seen[m.Key+"|"+m.Label]++
		}
	}
	for i := range items {
		for j := range items[i].Marks {
			m := &items[i].Marks[j]
			m.Unique = seen[m.Key+"|"+m.Label] == 1
		}
	}
}

func (a *Server) compareOne(ctx context.Context, id int64) (compareItem, error) {
	var it compareItem
	var img imageDest
	var highlights []textSection
	err := a.db.QueryRow(ctx, `
		SELECT s.id, s.english_name, s.scientific_name, s.family_en, `+speciesImageColumns+`,
		       coalesce(d.length_text, ''), coalesce(d.highlights, '[]'), rs.months
		FROM species s
		LEFT JOIN species_images si ON si.species_id = s.id AND si.status = 'ok'
		LEFT JOIN species_details d ON d.species_id = s.id AND d.status = 'ok'
		LEFT JOIN region_species rs ON rs.species_id = s.id
		WHERE s.id = $1`, id).
		Scan(append(append([]any{&it.ID, &it.EnglishName, &it.ScientificName, &it.FamilyEn}, img.targets()...),
			&it.Length, &highlights, &it.Months)...)
	if err != nil {
		return it, err
	}
	if im := a.image(img); im != nil {
		it.Image = &im.URL
	}
	for _, h := range highlights {
		switch h.Title {
		case "Males and females":
			it.Sexes = h.Text
		case "Voice":
			it.Voice = h.Text
		}
	}

	rows, err := a.db.Query(ctx, `
		SELECT DISTINCT ON (variant) key, thumb_key, width, height, variant, month, credit, licence, licence_url, source_url, tags
		FROM species_gallery WHERE species_id = $1 AND variant IN ('male', 'female', 'juvenile')
		ORDER BY variant, id`, id)
	if err != nil {
		return it, err
	}
	it.Variants, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (galleryPhoto, error) {
		var g galleryPhoto
		var month *int16
		err := row.Scan(&g.URL, &g.ThumbURL, &g.Width, &g.Height, &g.Variant, &month, &g.Credit, &g.Licence, &g.LicenceURL, &g.SourceURL, &g.Tags)
		g.URL, g.ThumbURL = a.media.URL(g.URL), a.media.URL(g.ThumbURL)
		if it.Image == nil {
			it.Image = &g.URL
		}
		return g, err
	})
	if err != nil {
		return it, err
	}
	if it.Image == nil { // no variant photo either: any gallery photo
		var key string
		if a.db.QueryRow(ctx, `SELECT key FROM species_gallery WHERE species_id = $1 ORDER BY id LIMIT 1`, id).Scan(&key) == nil {
			it.Image = new(a.media.URL(key))
		}
	}

	var snd gallerySound
	var ms int
	err = a.db.QueryRow(ctx, `
		SELECT key, spec_key, duration_ms, kind, credit, licence, source_url FROM species_sound_gallery
		WHERE species_id = $1 AND kind IN ('song', 'call') ORDER BY kind = 'song' DESC, id LIMIT 1`, id).
		Scan(&snd.URL, &snd.SpectrogramURL, &ms, &snd.Kind, &snd.Credit, &snd.Licence, &snd.SourceURL)
	if err == nil {
		snd.URL, snd.SpectrogramURL, snd.DurationS = a.media.URL(snd.URL), a.media.URL(snd.SpectrogramURL), float64(ms)/1000
		it.Sound = &snd
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return it, err
	}

	// Field marks noted on confirmed sightings (community or verified), most noted first, up to 4 per kind.
	rows, err = a.db.Query(ctx, `
		WITH obs AS (SELECT features FROM observations
		             WHERE community_species_id = $1 AND status IN ('community', 'verified') AND NOT hidden),
		vals AS (
			SELECT k.key, v.value FROM obs, jsonb_each(obs.features) k,
			     jsonb_array_elements_text(CASE jsonb_typeof(k.value) WHEN 'array' THEN k.value ELSE jsonb_build_array(k.value) END) v(value)
			WHERE k.key = ANY($2))
		SELECT key, value, count(*)::int, (SELECT count(*)::int FROM obs) FROM vals GROUP BY key, value ORDER BY key, count(*) DESC`,
		id, compareKeys)
	if err != nil {
		return it, err
	}
	perKey := map[string]int{}
	it.Marks = []fieldMark{}
	for rows.Next() {
		var key, value string
		var n int
		if err := rows.Scan(&key, &value, &n, &it.Sightings); err != nil {
			rows.Close()
			return it, err
		}
		if perKey[key] < 4 {
			perKey[key]++
			it.Marks = append(it.Marks, fieldMark{Key: key, Label: featureLabel(key, value), Count: n})
		}
	}
	rows.Close()
	return it, rows.Err()
}

func featureLabel(key, value string) string {
	for _, f := range featureFields {
		if f.Key == key {
			for _, o := range f.Options {
				if o.Value == value {
					return o.Label
				}
			}
		}
	}
	return value
}
