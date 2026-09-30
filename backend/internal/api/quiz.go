package api

import (
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

type quizImage struct {
	URL       string `json:"url"`
	Credit    string `json:"credit"`
	Licence   string `json:"licence"`
	SourceURL string `json:"source_url"`
}

type quizOption struct {
	ID             int64  `json:"id"`
	EnglishName    string `json:"english_name"`
	ScientificName string `json:"scientific_name"`
}

type quizSound struct {
	URL            string `json:"url"`
	SpectrogramURL string `json:"spectrogram_url"`
	Credit         string `json:"credit"`
	Licence        string `json:"licence"`
}

type quizQuestion struct {
	Image       *quizImage   `json:"image,omitempty"` // picture quiz
	Sound       *quizSound   `json:"sound,omitempty"` // sound quiz
	MediaRef    string       `json:"media_ref"`       // "species:<id>", "photo:<id>", "gallery:<id>"…, for the QZ-12 unsuitable flag
	Reason      string       `json:"reason"`          // why this bird: weak (you keep missing it, QZ-14) | community (recorded lately) | yours (you looked it up) | local (Sierra Leone) | ""
	Answer      quizOption   `json:"answer"`
	Options     []quizOption `json:"options"` // 4, shuffled, answer included
	Explanation string       `json:"explanation"`
}

// Quiz media pools (QZ-12: trusted media only). Columns: species_id, key, credit, licence, source_url, ref, extra,
// tags (LIB-08/09, used by QZ-03 levels).
const (
	photoPool = `
			SELECT s.id AS species_id, si.key, si.credit, si.licence, si.source_url, 'species:' || s.id AS ref, '' AS extra, '{}'::text[] AS tags
			FROM species_images si JOIN species s ON s.id = si.species_id
			WHERE si.status = 'ok' AND si.quiz_suitable AND NOT s.extinct AND s.merged_into IS NULL
			UNION ALL
			SELECT o.community_species_id, m.key, u.display_name, m.licence::text, '', 'photo:' || m.id, '', m.tags
			FROM media m JOIN observations o ON o.id = m.observation_id JOIN users u ON u.id = o.user_id
			WHERE o.status = 'verified' AND NOT o.hidden AND m.kind = 'photo' AND m.quiz_suitable
			UNION ALL
			SELECT g.species_id, g.key, g.credit, g.licence, g.source_url, 'gallery:' || g.id, '', g.tags
			FROM species_gallery g WHERE g.quiz_suitable`
	soundPool = `
			SELECT ss.species_id, ss.key, ss.credit, ss.licence, ss.source_url, 'species-sound:' || ss.species_id AS ref,
			       ss.spec_key AS extra, '{}'::text[] AS tags
			FROM species_sounds ss JOIN species s ON s.id = ss.species_id
			WHERE ss.status = 'ok' AND ss.quiz_suitable AND NOT s.extinct AND s.merged_into IS NULL
			UNION ALL
			SELECT o.community_species_id, m.key, u.display_name, m.licence::text, '', 'sound:' || m.id, m.thumb_key, m.tags
			FROM media m JOIN observations o ON o.id = m.observation_id JOIN users u ON u.id = o.user_id
			WHERE o.status = 'verified' AND NOT o.hidden AND m.kind = 'sound' AND m.quiz_suitable
			UNION ALL
			SELECT g.species_id, g.key, g.credit, g.licence, g.source_url, 'sound-gallery:' || g.id, g.spec_key, ARRAY[g.kind]
			FROM species_sound_gallery g WHERE g.quiz_suitable`
)

// GET /quiz/picture (QZ-01) and /quiz/sound (QZ-02) ?n=10&family=&level=&habitat=&season=&scope=. Public, so guests can play (QZ-13).
// Distractors are confusable species: same genus first, then family, then order.
//
// QZ-03 levels: beginner = Sierra Leone's most-recorded birds, clear views (no young, female, in-flight or
// non-breeding photos; no alarm or flight calls) and options from other families; intermediate (default) = as above;
// expert = those harder photos and calls first, lookalike options.
func (a *Server) quiz(kind string) http.HandlerFunc {
	pool := photoPool
	if kind == "sound" {
		pool = soundPool
	}
	return func(w http.ResponseWriter, r *http.Request) { a.runQuiz(w, r, kind, pool) }
}

// hardViews are photo and sound tags that make a bird harder to name.
var hardViews = []string{"juvenile", "female", "in-flight", "non-breeding", "alarm", "flight"}

func (a *Server) buildQuiz(r *http.Request, kind, pool string) ([]quizQuestion, *httpErr) {
	n, _ := strconv.Atoi(r.URL.Query().Get("n"))
	if n <= 0 || n > 20 {
		n = 10
	}
	family := r.URL.Query().Get("family")
	focus := quizFocus(r.URL.Query().Get("focus"))
	scope := r.URL.Query().Get("scope")             // "" (for you) | week (recorded by the community lately) | mine (focus only)
	only := quizFocus(r.URL.Query().Get("species")) // LRN-02: a lesson's birds only
	level := r.URL.Query().Get("level")
	if level != "beginner" && level != "expert" {
		level = "intermediate"
	}
	// QZ-04: habitat (as birders noted it on trusted sightings), season (Sierra Leone's rainy May–Oct / dry
	// Nov–Apr), and the scopes near (lat, lng, km: the area checklist's birds) and lifelist (the viewer's own).
	habitat, season := r.URL.Query().Get("habitat"), r.URL.Query().Get("season")
	if habitat != "" && !allowed("habitat", habitat) {
		return nil, &httpErr{http.StatusBadRequest, "unknown habitat " + habitat, nil}
	}
	if season != "" && season != "rainy" && season != "dry" {
		return nil, &httpErr{http.StatusBadRequest, "season is rainy or dry", nil}
	}
	var within []int64 // nil = no restriction
	switch scope {
	case "near":
		lat, err1 := strconv.ParseFloat(r.URL.Query().Get("lat"), 64)
		lng, err2 := strconv.ParseFloat(r.URL.Query().Get("lng"), 64)
		if err1 != nil || err2 != nil || lat < -90 || lat > 90 || lng < -180 || lng > 180 {
			return nil, &httpErr{http.StatusBadRequest, "near needs lat and lng", nil}
		}
		km, err := strconv.Atoi(r.URL.Query().Get("km"))
		if err != nil {
			km = 10
		}
		birds, _, err := a.areaBirds(r.Context(), viewerID(r), lat, lng, min(max(km, 1), 50))
		if err != nil {
			return nil, &httpErr{http.StatusInternalServerError, "quiz near", err}
		}
		within = []int64{}
		for _, b := range birds {
			within = append(within, b.ID)
		}
	case "group": // COM-03: the birds a group's members have seen (agreed IDs); members only
		gid, _ := strconv.ParseInt(r.URL.Query().Get("group"), 10, 64)
		ok, err := memberOf(r.Context(), a.db, gid, viewerID(r))
		if err != nil {
			return nil, &httpErr{http.StatusInternalServerError, "quiz group", err}
		}
		if !ok || viewerID(r) == 0 {
			return nil, &httpErr{http.StatusNotFound, "no such group", nil}
		}
		rows, err := a.db.Query(r.Context(), `SELECT DISTINCT community_species_id FROM observations
			WHERE user_id IN (SELECT user_id FROM group_members WHERE group_id = $1)
			  AND status IN ('community', 'verified') AND NOT hidden`, gid)
		if err == nil {
			within, err = pgx.CollectRows(rows, pgx.RowTo[int64])
		}
		if err != nil {
			return nil, &httpErr{http.StatusInternalServerError, "quiz group", err}
		}
		within = append([]int64{}, within...)
	case "lifelist":
		if viewerID(r) == 0 {
			return nil, &httpErr{http.StatusUnauthorized, "sign in to quiz on your life list", nil}
		}
		rows, err := a.db.Query(r.Context(), `SELECT DISTINCT coalesce(community_species_id, species_id) FROM observations
			WHERE user_id = $1 AND NOT hidden AND coalesce(community_species_id, species_id) IS NOT NULL`, viewerID(r))
		if err == nil {
			within, err = pgx.CollectRows(rows, pgx.RowTo[int64])
		}
		if err != nil {
			return nil, &httpErr{http.StatusInternalServerError, "quiz life list", err}
		}
		within = append([]int64{}, within...) // not nil, even when empty
	}

	// Birds that matter to this person come first, without shutting out the rest: tier 0 = recorded by the community
	// in the last 30 days or in `focus` (looked up / got wrong, sent by the app), 1 = Sierra Leone, 2 = anywhere.
	// Sorting on tier + random()*1.5 mixes neighbouring tiers, so most questions are tier 0–1 and a few roam wider.
	// ponytail: ORDER BY random() over ~11k species is fine; sample smarter if the pool grows a lot.
	// QZ-14: adapt to the signed-in player's record per bird (LRN-06): birds they keep missing (under 70% right,
	// at least one miss) come first; birds they've mastered (3+ right at 80%+) come up rarely.
	weak, mastered := []int64{}, []int64{}
	if uid := viewerID(r); uid != 0 {
		rows, err := a.db.Query(r.Context(), `
			SELECT key::bigint, (value->>0)::int, (value->>1)::int FROM quiz_stats, jsonb_each(by_species) WHERE user_id = $1`, uid)
		if err != nil {
			return nil, &httpErr{http.StatusInternalServerError, "quiz record", err}
		}
		var id int64
		var right, wrong int
		if _, err := pgx.ForEachRow(rows, []any{&id, &right, &wrong}, func() error {
			switch n := right + wrong; {
			case wrong > 0 && float64(right) < 0.7*float64(n):
				weak = append(weak, id)
			case right >= 3 && float64(right) >= 0.8*float64(n):
				mastered = append(mastered, id)
			}
			return nil
		}); err != nil {
			return nil, &httpErr{http.StatusInternalServerError, "quiz record", err}
		}
	}

	rows, err := a.db.Query(r.Context(), `
		WITH pool AS (`+pool+`
		), picked AS (
			SELECT DISTINCT ON (species_id) * FROM pool
			WHERE $6 <> 'beginner' OR NOT tags && $7
			ORDER BY species_id, $6 = 'expert' AND NOT tags && $7, random()
		), recent AS (
			SELECT DISTINCT coalesce(community_species_id, species_id) AS species_id FROM observations
			WHERE NOT hidden AND observed_at > now() - interval '30 days' AND coalesce(community_species_id, species_id) IS NOT NULL
		), tiered AS (
			SELECT p.*, CASE WHEN p.species_id = ANY($11) THEN 'weak'
			                 WHEN p.species_id IN (SELECT species_id FROM recent) THEN 'community'
			                 WHEN p.species_id = ANY($3) THEN 'yours'
			                 WHEN EXISTS (SELECT 1 FROM region_species rs WHERE rs.species_id = p.species_id) THEN 'local'
			                 ELSE '' END AS reason
			FROM picked p
		)
		SELECT p.species_id, s.english_name, s.scientific_name, s.genus, s.family_sci, s.family_en, s.order_name,
		       p.key, p.credit, p.licence, p.source_url, p.ref, p.extra, p.reason
		FROM tiered p JOIN species s ON s.id = p.species_id
		WHERE ($1 = '' OR s.family_sci = $1) AND (cardinality($5::bigint[]) = 0 OR p.species_id = ANY($5))
		  AND ($4 <> 'week' OR p.reason = 'community')
		  AND ($4 <> 'mine' OR p.species_id = ANY($3))
		  AND ($6 <> 'beginner' OR cardinality($5::bigint[]) > 0 OR $8::bigint[] IS NOT NULL -- chosen birds stay in
		       OR p.species_id IN (SELECT species_id FROM region_species ORDER BY records DESC LIMIT 150))
		  AND ($8::bigint[] IS NULL OR p.species_id = ANY($8))
		  AND ($9 = '' OR EXISTS (SELECT 1 FROM observations o WHERE o.community_species_id = p.species_id
		       AND o.status IN ('community', 'verified') AND NOT o.hidden AND o.features->>'habitat' = $9))
		  -- ponytail: "a quarter of its records in the season" also keeps residents; weigh by birder effort if dry-season bias misleads
		  AND ($10 = '' OR EXISTS (SELECT 1 FROM region_species rs WHERE rs.species_id = p.species_id AND 4 * (
		       CASE WHEN $10 = 'rainy' THEN rs.months[5] + rs.months[6] + rs.months[7] + rs.months[8] + rs.months[9] + rs.months[10]
		            ELSE rs.months[11] + rs.months[12] + rs.months[1] + rs.months[2] + rs.months[3] + rs.months[4] END)
		       >= (SELECT sum(m) FROM unnest(rs.months) m) AND (SELECT sum(m) FROM unnest(rs.months) m) > 0))
		ORDER BY CASE p.reason WHEN 'weak' THEN -2 WHEN 'local' THEN 1 WHEN '' THEN 2 ELSE 0 END
		         + CASE WHEN p.species_id = ANY($12) THEN 3 ELSE 0 END + random() * 1.5
		LIMIT $2`, family, n, focus, scope, only, level, hardViews, within, habitat, season, weak, mastered)
	if err != nil {
		return nil, &httpErr{http.StatusInternalServerError, "quiz", err}
	}
	type pick struct {
		opt                                      quizOption
		genus, famSci, famEn, order              string
		key, credit, licence, source, ref, extra string
		reason                                   string
	}
	picks, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (pick, error) {
		var p pick
		return p, row.Scan(&p.opt.ID, &p.opt.EnglishName, &p.opt.ScientificName, &p.genus, &p.famSci, &p.famEn, &p.order,
			&p.key, &p.credit, &p.licence, &p.source, &p.ref, &p.extra, &p.reason)
	})
	if err != nil {
		return nil, &httpErr{http.StatusInternalServerError, "quiz", err}
	}

	// Distractors and field marks for every question go to Postgres as one pipelined batch.
	questions := make([]quizQuestion, len(picks))
	var batch pgx.Batch
	for i, p := range picks {
		opts := []quizOption{p.opt}
		var sameGenus []string
		batch.Queue(`
			SELECT s.id, s.english_name, s.scientific_name, s.genus = $2
			FROM species s LEFT JOIN region_species rs ON rs.species_id = s.id
			WHERE s.id <> $1 AND NOT s.extinct AND s.merged_into IS NULL
			  -- The ordering never gets past the family and Sierra Leone's ~600 birds, so only sort those.
			  AND s.id IN (SELECT id FROM species WHERE family_sci = $3 UNION ALL SELECT species_id FROM region_species)
			ORDER BY CASE WHEN $5 THEN s.family_sci <> $3 ELSE s.genus = $2 END DESC, -- beginners: other families
			         (NOT $5 AND s.family_sci = $3) DESC,
			         rs.species_id IS NOT NULL DESC, -- local birds first
			         (NOT $5 AND s.order_name = $4) DESC, random() LIMIT 3`,
			p.opt.ID, p.genus, p.famSci, p.order, level == "beginner").Query(func(rows pgx.Rows) error {
			var o quizOption
			var genusMate bool
			_, err := pgx.ForEachRow(rows, []any{&o.ID, &o.EnglishName, &o.ScientificName, &genusMate}, func() error {
				opts = append(opts, o)
				if genusMate {
					sameGenus = append(sameGenus, o.EnglishName)
				}
				return nil
			})
			return err
		})
		batch.Queue(keyFeaturesSQL, p.opt.ID).Query(func(rows pgx.Rows) error {
			all, err := pgx.CollectRows(rows, pgx.RowTo[features])
			if err != nil {
				return err
			}
			rand.Shuffle(len(opts), func(i, j int) { opts[i], opts[j] = opts[j], opts[i] })
			q := quizQuestion{
				MediaRef:    p.ref,
				Reason:      p.reason,
				Answer:      p.opt,
				Options:     opts,
				Explanation: explain(p.opt.EnglishName, p.opt.ScientificName, p.famEn, sameGenus, topFeatures(all, 4)),
			}
			if kind == "sound" {
				q.Sound = &quizSound{a.media.URL(p.key), a.media.URL(p.extra), p.credit, p.licence}
			} else {
				q.Image = &quizImage{a.media.URL(p.key), p.credit, p.licence, p.source}
			}
			questions[i] = q
			return nil
		})
	}
	if err := a.db.SendBatch(r.Context(), &batch).Close(); err != nil {
		return nil, &httpErr{http.StatusInternalServerError, "quiz options", err}
	}
	return questions, nil
}

// httpErr is a request failure from a helper, written by the handler.
type httpErr struct {
	code int
	msg  string
	err  error // for 500s
}

func (e *httpErr) write(w http.ResponseWriter) {
	if e.code == http.StatusInternalServerError {
		internalError(w, e.msg, e.err)
		return
	}
	writeJSON(w, e.code, map[string]string{"error": e.msg})
}

func (a *Server) runQuiz(w http.ResponseWriter, r *http.Request, kind, pool string) {
	questions, e := a.buildQuiz(r, kind, pool)
	if e != nil {
		e.write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"questions": questions})
}

// explain is the QZ-06 answer note. marks are features birders noted on verified sightings.
func explain(name, sci, familyEn string, sameGenus, marks []string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s (%s) is in the %s family.", name, sci, strings.ToLower(familyEn))
	if len(marks) > 0 {
		fmt.Fprintf(&b, " Birders often note: %s.", strings.Join(marks, ", "))
	}
	if len(sameGenus) > 0 {
		fmt.Fprintf(&b, " Easily confused with the %s: same genus, so look closely.", strings.Join(sameGenus, " and the "))
	}
	return b.String()
}

// keyFeaturesSQL: recent verified sightings of a species with features noted, for topFeatures.
const keyFeaturesSQL = `
	SELECT o.features FROM observations o
	WHERE o.status = 'verified' AND NOT o.hidden AND o.community_species_id = $1 AND o.features <> '{}'
	ORDER BY o.created_at DESC LIMIT 200`

// topFeatures counts colours and markings across sightings; values seen ≥2 times, most common first.
func topFeatures(all []features, limit int) []string {
	label := map[string]string{}
	for _, f := range featureFields {
		for _, o := range f.Options {
			label[f.Key+"/"+o.Value] = strings.ToLower(o.Label)
		}
	}
	counts := map[string]int{}
	for _, f := range all {
		for _, key := range []string{"colours", "markings"} {
			list, _ := f[key].([]any)
			for _, v := range list {
				if s, ok := v.(string); ok {
					counts[key+"/"+s]++
				}
			}
		}
	}
	var keys []string
	for k, c := range counts {
		if c >= 2 {
			keys = append(keys, k)
		}
	}
	sort.Slice(keys, func(i, j int) bool {
		if counts[keys[i]] != counts[keys[j]] {
			return counts[keys[i]] > counts[keys[j]]
		}
		return keys[i] < keys[j]
	})
	var out []string
	for _, k := range keys[:min(limit, len(keys))] {
		out = append(out, label[k])
	}
	return out
}

// PUT /quiz/suitability {media_ref, suitable} — QZ-12, verifiers+.
func (a *Server) setQuizSuitable(w http.ResponseWriter, r *http.Request) {
	var body struct {
		MediaRef string `json:"media_ref"`
		Suitable bool   `json:"suitable"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	kind, idStr, _ := strings.Cut(body.MediaRef, ":")
	id, err := strconv.ParseInt(idStr, 10, 64)
	var sql string
	switch {
	case err != nil:
	case kind == "species":
		sql = `UPDATE species_images SET quiz_suitable = $2 WHERE species_id = $1 AND status = 'ok'`
	case kind == "species-sound":
		sql = `UPDATE species_sounds SET quiz_suitable = $2 WHERE species_id = $1 AND status = 'ok'`
	case kind == "photo" || kind == "sound":
		sql = `UPDATE media SET quiz_suitable = $2 WHERE id = $1`
	case kind == "gallery":
		sql = `UPDATE species_gallery SET quiz_suitable = $2 WHERE id = $1`
	case kind == "sound-gallery":
		sql = `UPDATE species_sound_gallery SET quiz_suitable = $2 WHERE id = $1`
	}
	if sql == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": `media_ref must be species:, species-sound:, photo:, sound:, gallery: or sound-gallery: plus an id`})
		return
	}
	tag, err := a.db.Exec(r.Context(), sql, id, body.Suitable)
	if err != nil {
		internalError(w, "quiz suitability", err)
		return
	}
	if tag.RowsAffected() == 0 {
		http.NotFound(w, r)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// quizFocus parses the app's "focus" list (species the person looked up or got wrong): up to 100 ids.
func quizFocus(v string) []int64 {
	out := []int64{}
	for _, f := range strings.Split(v, ",") {
		if id, err := strconv.ParseInt(strings.TrimSpace(f), 10, 64); err == nil && len(out) < 100 {
			out = append(out, id)
		}
	}
	return out
}
