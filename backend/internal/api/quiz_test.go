package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/slbirdwatch/backend/internal/database"
)

func TestTopFeaturesAndExplain(t *testing.T) {
	all := []features{
		{"colours": []any{"black", "white"}, "markings": []any{"crest"}},
		{"colours": []any{"black", "white"}},
		{"colours": []any{"black"}, "markings": []any{"crest"}},
		{"colours": []any{"red"}}, // once: dropped
	}
	if got := fmt.Sprint(topFeatures(all, 4)); got != "[black white crest]" {
		t.Fatalf("topFeatures: %s", got)
	}
	e := explain("Pied Crow", "Corvus albus", "Crows, Jays", []string{"Hooded Crow"}, []string{"black", "white"})
	for _, want := range []string{"crows, jays family", "Birders often note: black, white", "Easily confused with the Hooded Crow"} {
		if !strings.Contains(e, want) {
			t.Errorf("explanation %q lacks %q", e, want)
		}
	}
}

func TestPictureQuiz(t *testing.T) {
	h := testRouter(t)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/quiz/picture?n=5", nil)) // guest (QZ-13)
	var body struct{ Questions []quizQuestion }
	json.NewDecoder(rec.Body).Decode(&body)
	if rec.Code != 200 {
		t.Fatalf("status %d", rec.Code)
	}
	if len(body.Questions) == 0 {
		t.Skip("no seeded species photos yet: run seed-images")
	}
	if len(body.Questions) > 5 {
		t.Fatalf("asked for 5, got %d", len(body.Questions))
	}
	seen := map[int64]bool{}
	for _, q := range body.Questions {
		if seen[q.Answer.ID] {
			t.Fatalf("species repeated in one quiz: %d", q.Answer.ID)
		}
		seen[q.Answer.ID] = true
		ids := map[int64]bool{}
		hasAnswer := false
		for _, o := range q.Options {
			ids[o.ID] = true
			hasAnswer = hasAnswer || o.ID == q.Answer.ID
		}
		if len(q.Options) != 4 || len(ids) != 4 || !hasAnswer {
			t.Fatalf("options must be 4 distinct incl. answer: %+v", q.Options)
		}
		if !strings.HasPrefix(q.Image.URL, "/media/") || q.Explanation == "" || q.Image.Licence == "" {
			t.Fatalf("question missing image/explanation/licence: %+v", q)
		}
	}

	// Distractors come from the same genus when it has other species: ostriches (Struthio) have exactly 2.
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/quiz/picture?n=20&family=Struthionidae", nil))
	json.NewDecoder(rec.Body).Decode(&body)
	for _, q := range body.Questions {
		mates := 0
		for _, o := range q.Options {
			if strings.HasPrefix(o.ScientificName, "Struthio ") {
				mates++
			}
		}
		if mates != 2 {
			t.Fatalf("ostrich quiz should offer both Struthio species: %+v", q.Options)
		}
	}
}

func TestQuizSuitability(t *testing.T) {
	call, email := apiTest(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ver"))
	token := out["token"].(string)
	db := testDB(t)
	var ostrich int64
	db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = 'Struthio camelus'`).Scan(&ostrich)
	ref := fmt.Sprintf(`{"media_ref":"species:%d","suitable":false}`, ostrich)

	if code, _ := call("PUT", "/quiz/suitability", token, ref); code != 403 {
		t.Fatalf("member flagging: %d", code)
	}
	db.Exec(t.Context(), `UPDATE users SET role = 'verifier' WHERE email = $1`, email)
	if code, _ := call("PUT", "/quiz/suitability", token, `{"media_ref":"video:1"}`); code != 400 {
		t.Fatalf("bad ref: %d", code)
	}
	if code, _ := call("PUT", "/quiz/suitability", token, ref); code != 204 {
		t.Skipf("no seeded ostrich photo to flag (%d)", code)
	}
	t.Cleanup(func() {
		db.Exec(context.Background(), `UPDATE species_images SET quiz_suitable = true WHERE species_id = $1`, ostrich)
	})

	h := testRouter(t)
	for range 5 {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", "/quiz/picture?n=20&family=Struthionidae", nil))
		var body struct{ Questions []quizQuestion }
		json.NewDecoder(rec.Body).Decode(&body)
		for _, q := range body.Questions {
			if q.MediaRef == fmt.Sprintf("species:%d", ostrich) { // other ostrich photos (gallery) may still be used
				t.Fatal("unsuitable photo still used in quizzes")
			}
		}
	}
}

func TestQuizLevels(t *testing.T) {
	h := testRouter(t)
	db := testDB(t)
	get := func(q string) []quizQuestion {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", "/quiz/picture?"+q, nil))
		var body struct{ Questions []quizQuestion }
		json.NewDecoder(rec.Body).Decode(&body)
		if rec.Code != 200 {
			t.Fatalf("%s: status %d", q, rec.Code)
		}
		return body.Questions
	}

	// A bird with one plain and one young-bird gallery photo, and no other quiz media.
	var sp int64
	db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = 'Aptenodytes forsteri'`).Scan(&sp)
	var plain, young int64
	db.QueryRow(t.Context(), `INSERT INTO species_gallery (species_id, key, thumb_key, width, height, credit, licence, licence_url, source_url, source_id)
		VALUES ($1, 'lvl-a', 'lvl-a-t', 1, 1, 'A', 'CC0', 'u', 'u', 'test:lvl-plain') RETURNING id`, sp).Scan(&plain)
	db.QueryRow(t.Context(), `INSERT INTO species_gallery (species_id, key, thumb_key, width, height, credit, licence, licence_url, source_url, source_id, tags)
		VALUES ($1, 'lvl-b', 'lvl-b-t', 1, 1, 'B', 'CC0', 'u', 'u', 'test:lvl-young', '{juvenile}') RETURNING id`, sp).Scan(&young)
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM species_gallery WHERE source_id LIKE 'test:lvl-%'`) })
	db.Exec(t.Context(), `UPDATE species_images SET quiz_suitable = false WHERE species_id = $1`, sp)
	t.Cleanup(func() {
		db.Exec(context.Background(), `UPDATE species_images SET quiz_suitable = true WHERE species_id = $1`, sp)
	})

	for range 5 { // the pick is random among allowed photos, so look a few times
		only := fmt.Sprintf("species=%d&n=1&level=", sp)
		if q := get(only + "beginner"); len(q) != 1 || q[0].MediaRef != fmt.Sprintf("gallery:%d", plain) {
			t.Fatalf("beginner: %+v", q)
		}
		if q := get(only + "expert"); len(q) != 1 || q[0].MediaRef != fmt.Sprintf("gallery:%d", young) {
			t.Fatalf("expert: %+v", q)
		}
	}

	// Beginner: Sierra Leone's well-recorded birds, and no option from the answer's family.
	qs := get("level=beginner&n=10")
	if len(qs) == 0 {
		t.Skip("no seeded quiz photos")
	}
	for _, q := range qs {
		var top bool
		db.QueryRow(t.Context(), `SELECT $1 IN (SELECT species_id FROM region_species ORDER BY records DESC LIMIT 150)`, q.Answer.ID).Scan(&top)
		if !top {
			t.Errorf("beginner asked about %s", q.Answer.EnglishName)
		}
		for _, o := range q.Options {
			var same bool
			db.QueryRow(t.Context(), `SELECT a.family_sci = b.family_sci FROM species a, species b WHERE a.id = $1 AND b.id = $2`, q.Answer.ID, o.ID).Scan(&same)
			if same && o.ID != q.Answer.ID {
				t.Errorf("beginner option %s shares %s's family", o.EnglishName, q.Answer.EnglishName)
			}
		}
	}
}

func TestQuizScopes(t *testing.T) {
	call, email := apiTest(t)
	db := testDB(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	tok := out["token"].(string)
	var sp int64
	db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = 'Aptenodytes forsteri'`).Scan(&sp)
	db.Exec(t.Context(), `INSERT INTO species_gallery (species_id, key, thumb_key, width, height, credit, licence, licence_url, source_url, source_id)
		VALUES ($1, 'sc-a', 'sc-a-t', 1, 1, 'A', 'CC0', 'u', 'u', 'test:scope')`, sp)
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM species_gallery WHERE source_id = 'test:scope'`) })
	answers := func(tok, q string) (int, map[int64]bool) {
		code, body := call("GET", "/quiz/picture?"+q, tok, "")
		got := map[int64]bool{}
		if qs, ok := body["questions"].([]any); ok {
			for _, x := range qs {
				got[int64(x.(map[string]any)["answer"].(map[string]any)["id"].(float64))] = true
			}
		}
		return code, got
	}

	// life list: sign-in only, and only the viewer's birds
	if code, _ := answers("", "scope=lifelist"); code != 401 {
		t.Errorf("guest life list: %d", code)
	}
	if code, got := answers(tok, "scope=lifelist"); code != 200 || len(got) != 0 {
		t.Errorf("empty life list: %d %v", code, got)
	}
	_, o := call("POST", "/observations", tok, fmt.Sprintf(`{"species_id":%d,"observed_at":"2026-01-10T08:00:00Z","lat":8.4,"lng":-13.2,"features":{"habitat":"coast"}}`, sp))
	if code, got := answers(tok, "scope=lifelist&n=5"); code != 200 || len(got) != 1 || !got[sp] {
		t.Errorf("life list quiz: %d %v", code, got)
	}

	// habitat: from habitats noted on trusted sightings
	db.Exec(t.Context(), `UPDATE observations SET status = 'verified', community_species_id = $2 WHERE id = $1`, int64(o["id"].(float64)), sp)
	only := fmt.Sprintf("species=%d&n=1&", sp)
	if _, got := answers("", only+"habitat=coast"); !got[sp] {
		t.Errorf("coast quiz missed the bird: %v", got)
	}
	if _, got := answers("", only+"habitat=forest"); len(got) != 0 {
		t.Errorf("forest quiz: %v", got)
	}
	for _, bad := range []string{"habitat=moon", "season=monsoon", "scope=near&lat=x&lng=1"} {
		if code, _ := answers("", bad); code != 400 {
			t.Errorf("%s: %d", bad, code)
		}
	}

	// season: every answer has at least a quarter of its Sierra Leone records in that season
	_, got := answers("", "season=rainy&n=20")
	for id := range got {
		var ok bool
		db.QueryRow(t.Context(), `SELECT 4 * (months[5] + months[6] + months[7] + months[8] + months[9] + months[10]) >= (SELECT sum(m) FROM unnest(months) m)
			FROM region_species WHERE species_id = $1`, id).Scan(&ok)
		if !ok {
			t.Errorf("rainy-season quiz asked about %d", id)
		}
	}

	// near: only birds on the area checklist (GBIF faked: one Sierra Leone bird)
	var local, key int64
	db.QueryRow(t.Context(), `SELECT rs.species_id, rs.gbif_key FROM region_species rs JOIN species s ON s.id = rs.species_id
		WHERE rs.gbif_key IS NOT NULL AND NOT s.sensitive ORDER BY rs.records DESC LIMIT 1`).Scan(&local, &key)
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, `{"facets":[{"counts":[{"name":"%d","count":40}]}]}`, key)
	}))
	defer fake.Close()
	old := areaGBIF.base
	areaGBIF.base = fake.URL
	defer func() { areaGBIF.base = old }()
	cache, _ := database.OpenRedis()
	cache.Del(t.Context(), "area:-4.00,20.00,5")
	t.Cleanup(func() { cache.Del(context.Background(), "area:-4.00,20.00,5") })
	if code, got := answers("", "scope=near&lat=-4&lng=20&km=5&n=5"); code != 200 || len(got) > 1 || (len(got) == 1 && !got[local]) {
		t.Errorf("near quiz: %d %v (want only %d)", code, got, local)
	}
}

func TestQuizAdapts(t *testing.T) {
	call, email := apiTest(t)
	db := testDB(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	tok := out["token"].(string)
	// three Sierra Leone birds with a quiz photo
	rows, _ := db.Query(t.Context(), `SELECT si.species_id FROM species_images si JOIN region_species rs USING (species_id)
		WHERE si.status = 'ok' AND si.quiz_suitable ORDER BY rs.records DESC LIMIT 3`)
	var ids []int64
	for rows.Next() {
		var id int64
		rows.Scan(&id)
		ids = append(ids, id)
	}
	if len(ids) < 3 {
		t.Skip("no seeded quiz photos")
	}
	weak, mastered, other := ids[0], ids[1], ids[2]
	body := fmt.Sprintf(`{"quizzes":1,"answered":9,"correct":5,"bestStreak":5,"missed":{},"bySpecies":{"%d":[0,3],"%d":[5,0]}}`, weak, mastered)
	if code, _ := call("POST", "/me/quiz-stats", tok, body); code != 200 {
		t.Fatalf("stats: %d", code)
	}
	first := func(a, b int64) (int64, string) {
		_, v := call("GET", fmt.Sprintf("/quiz/picture?n=1&species=%d,%d", a, b), tok, "")
		q := v["questions"].([]any)[0].(map[string]any)
		return int64(q["answer"].(map[string]any)["id"].(float64)), q["reason"].(string)
	}
	for range 5 { // the order has a random part; these should win every time
		if id, why := first(other, weak); id != weak || why != "weak" {
			t.Fatalf("weak bird should come first: got %d (%s)", id, why)
		}
		if id, _ := first(mastered, other); id != other {
			t.Fatalf("mastered bird should come last: got %d", id)
		}
	}
	// guests get no adapting
	_, v := call("GET", fmt.Sprintf("/quiz/picture?n=2&species=%d,%d", weak, other), "", "")
	for _, q := range v["questions"].([]any) {
		if q.(map[string]any)["reason"] == "weak" {
			t.Error("guest quiz marked weak")
		}
	}
}
