package main

import (
	"context"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func TestSharePages(t *testing.T) {
	call, email := apiTest(t)
	h := testRouter(t)
	db := testDB(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada <b>Birder</b>"))
	tok := out["token"].(string)
	page := func(path string) (int, string) {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		return rec.Code, rec.Body.String()
	}
	var crow int64
	db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = 'Corvus albus'`).Scan(&crow)
	code, body := page("/s/" + strconv.FormatInt(crow, 10))
	for _, want := range []string{"<title>Pied Crow · SL Birdwatch", `og:title" content="Pied Crow"`, "Corvus albus", "slbirdwatch://species/"} {
		if code != 200 || !strings.Contains(body, want) {
			t.Fatalf("species page lacks %q (%d)", want, code)
		}
	}
	if code, _ := page("/s/999999999"); code != 404 {
		t.Errorf("unknown species: %d", code)
	}

	_, o := call("POST", "/observations", tok, `{"species_id":`+strconv.FormatInt(crow, 10)+`,"observed_at":"2026-03-04T08:00:00Z","lat":8.4844,"lng":-13.2344,"notes":"On the <script>roof</script>"}`)
	oid := strconv.Itoa(int(o["id"].(float64)))
	code, body = page("/o/" + oid)
	if code != 200 || !strings.Contains(body, "Pied Crow") || !strings.Contains(body, "4 March 2026") {
		t.Fatalf("sighting page: %d", code)
	}
	if strings.Contains(body, "8.4844") || strings.Contains(body, "<script>") || strings.Contains(body, "<b>Birder") {
		t.Error("sighting page leaks coordinates or unescaped text")
	}
	db.Exec(t.Context(), `UPDATE observations SET hidden = true WHERE id = $1`, oid)
	if code, _ := page("/o/" + oid); code != 404 {
		t.Errorf("hidden sighting: %d", code)
	}
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM observations WHERE id = $1`, oid) })
}
