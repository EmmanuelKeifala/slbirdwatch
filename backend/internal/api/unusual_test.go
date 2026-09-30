package api

import (
	"context"
	"fmt"
	"strconv"
	"testing"
)

func TestUnusual(t *testing.T) {
	call, email := apiTest(t)
	db := testDB(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	ada := out["token"].(string)
	_, out = call("POST", "/auth/signup", "", creds("b-"+email, "correct horse", "Bo"))
	bo := out["token"].(string)
	_, out = call("POST", "/auth/signup", "", creds("v-"+email, "correct horse", "Vi"))
	vi := out["token"].(string)
	t.Cleanup(func() {
		db.Exec(context.Background(), `DELETE FROM users WHERE email = ANY($1)`, []string{"b-" + email, "v-" + email})
	})
	db.Exec(t.Context(), `UPDATE users SET role = 'verifier' WHERE email = $1`, "v-"+email)
	id := func(sci string) string {
		var n int64
		db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = $1`, sci).Scan(&n)
		return strconv.FormatInt(n, 10)
	}
	harrier, penguin := id("Circus aeruginosus"), id("Aptenodytes forsteri") // a dry-season visitor; not a West African bird
	var records int
	db.QueryRow(t.Context(), `SELECT records FROM region_species WHERE species_id = $1`, harrier).Scan(&records)
	if records < seasonMinRecords {
		t.Skip("region_species not seeded")
	}

	likely := func(sp, lat, lng, date string) string {
		_, v := call("GET", fmt.Sprintf("/species/%s/likely?lat=%s&lng=%s&date=%s", sp, lat, lng, date), "", "")
		return fmt.Sprint(v["unusual"])
	}
	for _, c := range []struct{ sp, lat, lng, date, want string }{
		{harrier, "8.48", "-13.23", "2026-07-15T08:00:00Z", "season"},
		{harrier, "8.48", "-13.23", "2026-12-15T08:00:00Z", ""},
		{penguin, "8.48", "-13.23", "2026-12-15T08:00:00Z", "range"},
		{penguin, "51.5", "-0.1", "2026-12-15T08:00:00Z", ""}, // outside Sierra Leone: no judgement
	} {
		if got := likely(c.sp, c.lat, c.lng, c.date); got != c.want {
			t.Errorf("%s at %s,%s on %s: %q, want %q", c.sp, c.lat, c.lng, c.date[:10], got, c.want)
		}
	}
	if code, _ := call("GET", "/species/"+harrier+"/likely?lat=x", "", ""); code != 400 {
		t.Errorf("bad query: %d", code)
	}

	// A July harrier: flagged, and two members agreeing isn't enough; a verifier settles it.
	_, o := call("POST", "/observations", ada, `{"species_id":`+harrier+`,"observed_at":"2026-07-15T08:00:00Z","lat":8.48,"lng":-13.23}`)
	oid := strconv.Itoa(int(o["id"].(float64)))
	if o["unusual"] != "season" {
		t.Fatalf("new sighting: %v", o["unusual"])
	}
	call("POST", "/observations/"+oid+"/identifications", bo, `{"species_id":`+harrier+`}`)
	if _, v := call("GET", "/observations/"+oid, ada, ""); v["status"] != "needs_id" || v["unusual"] != "season" {
		t.Fatalf("after two agree: %v %v", v["status"], v["unusual"])
	}
	_, q := call("GET", "/verify/queue?unusual=1", vi, "")
	found := false
	for _, it := range q["items"].([]any) {
		found = found || fmt.Sprint(int(it.(map[string]any)["id"].(float64))) == oid
	}
	if !found {
		t.Error("not in the unusual queue")
	}
	call("POST", "/observations/"+oid+"/identifications", vi, `{"species_id":`+harrier+`}`)
	if _, v := call("GET", "/observations/"+oid, ada, ""); v["status"] != "verified" {
		t.Fatalf("after a verifier: %v", v["status"])
	}

	// An ordinary December harrier still settles by agreement.
	_, o = call("POST", "/observations", ada, `{"species_id":`+harrier+`,"observed_at":"2025-12-15T08:00:00Z","lat":8.49,"lng":-13.24}`)
	oid = strconv.Itoa(int(o["id"].(float64)))
	call("POST", "/observations/"+oid+"/identifications", bo, `{"species_id":`+harrier+`}`)
	if _, v := call("GET", "/observations/"+oid, ada, ""); v["status"] != "community" || v["unusual"] != "" {
		t.Errorf("December harrier: %v %v", v["status"], v["unusual"])
	}
}
