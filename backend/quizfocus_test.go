package main

import (
	"context"
	"strconv"
	"testing"
	"time"
)

func TestQuizFocusAndWeek(t *testing.T) {
	call, email := apiTest(t)
	db := testDB(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	token := out["token"].(string)
	var emperor, king int64
	db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = 'Aptenodytes forsteri'`).Scan(&emperor)
	db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = 'Aptenodytes patagonicus'`).Scan(&king)
	var gid int64
	db.QueryRow(t.Context(), `INSERT INTO species_gallery (species_id, key, thumb_key, width, height, credit, licence, licence_url, source_url, source_id)
		VALUES ($1, 'k', 't', 1, 1, 'Jo', 'CC0', 'u', 's', 'test:q1') RETURNING id`, emperor).Scan(&gid)
	db.Exec(t.Context(), `INSERT INTO species_gallery (species_id, key, thumb_key, width, height, credit, licence, licence_url, source_url, source_id)
		VALUES ($1, 'k', 't', 1, 1, 'Jo', 'CC0', 'u', 's', 'test:q2')`, king)
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM species_gallery WHERE source_id LIKE 'test:q%'`) })

	// A community sighting this week puts the Emperor Penguin in "this week's birds".
	call("POST", "/observations", token, `{"species_id":`+strconv.FormatInt(emperor, 10)+`,"observed_at":"`+
		time.Now().UTC().Format(time.RFC3339)+`","lat":8.48,"lng":-13.23}`)
	answers := func(query string) map[int64]string {
		t.Helper()
		code, res := call("GET", "/quiz/picture?n=20&"+query, "", "")
		if code != 200 {
			t.Fatalf("%s: %d %v", query, code, res)
		}
		got := map[int64]string{}
		for _, q := range res["questions"].([]any) {
			m := q.(map[string]any)
			got[int64(m["answer"].(map[string]any)["id"].(float64))] = m["reason"].(string)
		}
		return got
	}
	week := answers("scope=week")
	if week[emperor] != "community" {
		t.Errorf("this week's birds missing the Emperor Penguin: %v", week)
	}
	for id, reason := range week {
		if reason != "community" {
			t.Errorf("week quiz has %d (%q)", id, reason)
		}
	}
	mine := answers("scope=mine&focus=" + strconv.FormatInt(king, 10))
	if len(mine) != 1 || mine[king] != "yours" {
		t.Errorf("my birds quiz: %v", mine)
	}

	// A verifier can pull a gallery photo out of quizzes.
	db.Exec(t.Context(), `UPDATE users SET role = 'verifier' WHERE email = $1`, email)
	if code, _ := call("PUT", "/quiz/suitability", token, `{"media_ref":"gallery:`+strconv.FormatInt(gid, 10)+`","suitable":false}`); code != 204 {
		t.Fatalf("suitability: %d", code)
	}
	_, res := call("GET", "/quiz/picture?n=20&scope=week", "", "")
	for _, q := range res["questions"].([]any) {
		if q.(map[string]any)["media_ref"] == "gallery:"+strconv.FormatInt(gid, 10) {
			t.Error("unsuitable gallery photo still quizzed")
		}
	}
}
