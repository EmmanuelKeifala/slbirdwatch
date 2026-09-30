package api

import (
	"context"
	"encoding/csv"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func TestExport(t *testing.T) {
	call, email := apiTest(t)
	h := testRouter(t)
	db := testDB(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada Export"))
	member := out["token"].(string)
	_, out = call("POST", "/auth/signup", "", creds("a-"+email, "correct horse", "Admin"))
	admin := out["token"].(string)
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, "a-"+email) })
	db.Exec(t.Context(), `UPDATE users SET role = 'admin' WHERE email = $1`, "a-"+email)
	var me int64
	db.QueryRow(t.Context(), `SELECT id FROM users WHERE email = $1`, email).Scan(&me)
	// a verified crow at an exact spot, a verified sensitive penguin, and an unverified crow
	ids := map[string]int64{}
	for _, v := range []struct{ key, sci, status string }{{"crow", "Corvus albus", "verified"}, {"penguin", "Aptenodytes forsteri", "verified"}, {"open", "Corvus albus", "needs_id"}} {
		var id int64
		db.QueryRow(t.Context(), `INSERT INTO observations (user_id, species_id, community_species_id, observed_at, location, status, accuracy_m)
			SELECT $1, id, CASE WHEN $3 = 'verified' THEN id END, now(), 'POINT(-13.23456 8.48765)', $3::observation_status, 12
			FROM species WHERE scientific_name = $2 RETURNING id`, me, v.sci, v.status).Scan(&id)
		ids[v.key] = id
	}
	db.Exec(t.Context(), `UPDATE species SET sensitive = true, obscure_cell = 0.1 WHERE scientific_name = 'Aptenodytes forsteri'`)
	t.Cleanup(func() {
		db.Exec(context.Background(), `UPDATE species SET sensitive = false WHERE scientific_name = 'Aptenodytes forsteri'`)
	})
	db.Exec(t.Context(), `UPDATE users SET private_profile = true, default_licence = 'cc-by' WHERE id = $1`, me)

	if code, _ := call("POST", "/admin/export-link", member, ""); code != 403 {
		t.Fatalf("member: %d", code)
	}
	_, link := call("POST", "/admin/export-link", admin, "")
	u := link["url"].(string)
	path := u[strings.Index(u, "/export/"):]
	get := func() (int, string) {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		return rec.Code, rec.Body.String()
	}
	code, body := get()
	if code != 200 {
		t.Fatalf("download: %d", code)
	}
	recs, err := csv.NewReader(strings.NewReader(body)).ReadAll()
	if err != nil || recs[0][0] != "occurrenceID" {
		t.Fatalf("csv: %v", err)
	}
	col := map[string]int{}
	for i, h := range recs[0] {
		col[h] = i
	}
	byID := map[string][]string{}
	for _, r := range recs[1:] {
		byID[r[0]] = r
	}
	crow, penguin := byID["slbirdwatch:"+strconv.FormatInt(ids["crow"], 10)], byID["slbirdwatch:"+strconv.FormatInt(ids["penguin"], 10)]
	if crow == nil || penguin == nil || byID["slbirdwatch:"+strconv.FormatInt(ids["open"], 10)] != nil {
		t.Fatalf("verified only: crow %v penguin %v", crow != nil, penguin != nil)
	}
	if crow[col["decimalLatitude"]] != "8.48765" || crow[col["coordinateUncertaintyInMeters"]] != "12" || crow[col["countryCode"]] != "SL" {
		t.Errorf("crow location: %v", crow)
	}
	if penguin[col["decimalLatitude"]] != "8.45000" || penguin[col["coordinateUncertaintyInMeters"]] != "7881" {
		t.Errorf("sensitive not blurred: %s %s", penguin[col["decimalLatitude"]], penguin[col["coordinateUncertaintyInMeters"]])
	}
	if strings.Contains(body, "Ada Export") || !strings.Contains(crow[col["recordedBy"]], "SL Birdwatch observer") {
		t.Error("private observer named")
	}
	if !strings.Contains(crow[col["license"]], "licenses/by/4.0") {
		t.Errorf("licence: %s", crow[col["license"]])
	}
	if code, _ := get(); code != 403 {
		t.Errorf("link used twice: %d", code)
	}
}
