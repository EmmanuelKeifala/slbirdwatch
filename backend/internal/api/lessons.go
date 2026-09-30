package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
)

// LRN-02 lessons: a group of birds to learn one by one, ending in a quiz on just those birds. Written by
// admins (ADM-05, table lessons): whole families (most recorded Sierra Leone birds first, up to 8), or a
// hand-picked list of birds in order, or with neither, Sierra Leone's most recorded birds.

type lessonDef struct {
	Slug       string   `json:"slug"`
	Title      string   `json:"title"`
	Blurb      string   `json:"blurb"`
	Families   []string `json:"families"`
	SpeciesIDs []int64  `json:"species_ids"`
	Position   int      `json:"position"`
	Published  bool     `json:"published"`
}

const lessonColumns = `slug, title, blurb, families, species_ids, position, published`

func scanLesson(row pgx.CollectableRow) (lessonDef, error) {
	var l lessonDef
	err := row.Scan(&l.Slug, &l.Title, &l.Blurb, &l.Families, &l.SpeciesIDs, &l.Position, &l.Published)
	return l, err
}

func (a *Server) loadLessons(ctx context.Context, all bool) ([]lessonDef, error) {
	rows, err := a.db.Query(ctx, `SELECT `+lessonColumns+` FROM lessons WHERE published OR $1 ORDER BY position, title`, all)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanLesson)
}

type lessonBird struct {
	ID             int64         `json:"id"`
	EnglishName    string        `json:"english_name"`
	ScientificName string        `json:"scientific_name"`
	FamilyEn       string        `json:"family_en"`
	Image          *string       `json:"image"`
	Sexes          string        `json:"sexes"`
	Voice          string        `json:"voice"`
	Length         string        `json:"length"`
	Sound          *gallerySound `json:"sound"`
	Mnemonic       string        `json:"mnemonic"` // LRN-08
}

func (a *Server) lessonBirds(ctx context.Context, l lessonDef, withSounds bool) ([]lessonBird, error) {
	return a.birdsWhere(ctx, l.Families, l.SpeciesIDs, 0, withSounds)
}

// lessonBirdsByID is the same card data for one bird (flashcards, LRN-04), wherever it lives.
func (a *Server) lessonBirdsByID(r *http.Request, id int64) ([]lessonBird, error) {
	return a.birdsWhere(r.Context(), nil, nil, id, true)
}

// birdsWhere: one bird (id > 0), or the picked birds in order, or the families' / Sierra Leone's most recorded.
func (a *Server) birdsWhere(ctx context.Context, families []string, picked []int64, id int64, withSounds bool) ([]lessonBird, error) {
	rows, err := a.db.Query(ctx, `
		SELECT s.id, s.english_name, s.scientific_name, s.family_en,
		       coalesce(si.key, (SELECT key FROM species_gallery g WHERE g.species_id = s.id ORDER BY g.reference DESC, g.id LIMIT 1)),
		       coalesce((SELECT h->>'text' FROM jsonb_array_elements(d.highlights) h WHERE h->>'title' = 'Males and females'), ''),
		       coalesce((SELECT h->>'text' FROM jsonb_array_elements(d.highlights) h WHERE h->>'title' = 'Voice'), ''),
		       coalesce(d.length_text, ''), coalesce((SELECT text FROM species_mnemonics m WHERE m.species_id = s.id), '')
		FROM species s LEFT JOIN region_species r ON r.species_id = s.id
		LEFT JOIN species_images si ON si.species_id = s.id AND si.status = 'ok'
		LEFT JOIN species_details d ON d.species_id = s.id AND d.status = 'ok'
		WHERE NOT s.extinct AND s.merged_into IS NULL
		  AND CASE WHEN $2 > 0 THEN s.id = $2
		           WHEN coalesce(cardinality($3::bigint[]), 0) > 0 THEN s.id = ANY($3)
		           ELSE r.species_id IS NOT NULL AND (coalesce(cardinality($1::text[]), 0) = 0 OR s.family_sci = ANY($1)) END
		ORDER BY array_position($3::bigint[], s.id), r.records DESC NULLS LAST
		LIMIT CASE WHEN coalesce(cardinality($3::bigint[]), 0) > 0 THEN 12 ELSE 8 END`, families, id, picked)
	if err != nil {
		return nil, err
	}
	birds, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (lessonBird, error) {
		var b lessonBird
		var key *string
		err := row.Scan(&b.ID, &b.EnglishName, &b.ScientificName, &b.FamilyEn, &key, &b.Sexes, &b.Voice, &b.Length, &b.Mnemonic)
		b.Image = a.mediaURL(key)
		return b, err
	})
	if err != nil {
		return nil, err
	}
	if !withSounds || len(birds) == 0 {
		return birds, nil
	}
	// Each bird's first song (else call), for all the birds in one query.
	index := make(map[int64]int, len(birds))
	ids := make([]int64, len(birds))
	for i, b := range birds {
		ids[i], index[b.ID] = b.ID, i
	}
	rows, err = a.db.Query(ctx, `SELECT DISTINCT ON (species_id) species_id, key, spec_key, duration_ms, kind, credit, licence, source_url
		FROM species_sound_gallery WHERE species_id = ANY($1) AND kind IN ('song', 'call')
		ORDER BY species_id, kind = 'song' DESC, id`, ids)
	if err != nil {
		return nil, err
	}
	var sid int64
	var ms int
	var snd gallerySound
	_, err = pgx.ForEachRow(rows, []any{&sid, &snd.URL, &snd.SpectrogramURL, &ms, &snd.Kind, &snd.Credit, &snd.Licence, &snd.SourceURL}, func() error {
		s := snd
		s.URL, s.SpectrogramURL, s.DurationS = a.media.URL(s.URL), a.media.URL(s.SpectrogramURL), float64(ms)/1000
		birds[index[sid]].Sound = &s
		return nil
	})
	return birds, err
}

// GET /lessons — the lessons with a cover photo and how many birds each has.
func (a *Server) listLessons(w http.ResponseWriter, r *http.Request) {
	type item struct {
		lessonDef
		Birds int     `json:"birds"`
		Cover *string `json:"cover"`
	}
	lessons, err := a.loadLessons(r.Context(), false)
	if err != nil {
		internalError(w, "lessons", err)
		return
	}
	out := []item{}
	for _, l := range lessons {
		birds, err := a.lessonBirds(r.Context(), l, false)
		if err != nil {
			internalError(w, "lessons", err)
			return
		}
		if len(birds) == 0 {
			continue
		}
		it := item{lessonDef: l, Birds: len(birds)}
		for _, b := range birds {
			if b.Image != nil {
				it.Cover = b.Image
				break
			}
		}
		out = append(out, it)
	}
	w.Header().Set("Cache-Control", "public, max-age=60") // admins edit lessons (ADM-05)
	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

// GET /lessons/{slug} — the lesson with its birds.
func (a *Server) getLesson(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.Query(r.Context(), `SELECT `+lessonColumns+` FROM lessons WHERE slug = $1 AND published`, r.PathValue("slug"))
	if err != nil {
		internalError(w, "lesson", err)
		return
	}
	l, err := pgx.CollectExactlyOneRow(rows, scanLesson)
	if errors.Is(err, pgx.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		internalError(w, "lesson", err)
		return
	}
	birds, err := a.lessonBirds(r.Context(), l, true)
	if err != nil {
		internalError(w, "lesson", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"slug": l.Slug, "title": l.Title, "blurb": l.Blurb, "birds": birds})
}
