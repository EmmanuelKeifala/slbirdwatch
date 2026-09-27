package main

import (
	"context"
	"math"
	"strconv"
	"testing"
	"time"
)

func TestSensitiveLevels(t *testing.T) {
	call, email := apiTest(t)
	db := testDB(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	admin := out["token"].(string)
	_, out = call("POST", "/auth/signup", "", creds("o-"+email, "correct horse", "Bo"))
	other := out["token"].(string)
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, "o-"+email) })
	db.Exec(t.Context(), `UPDATE users SET role = 'admin' WHERE email = $1`, email)
	var sid int64
	db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = 'Aptenodytes forsteri'`).Scan(&sid)
	t.Cleanup(func() {
		db.Exec(context.Background(), `UPDATE species SET sensitive = false, obscure_cell = 0.1 WHERE id = $1`, sid)
	})
	sp := strconv.FormatInt(sid, 10)

	if code, _ := call("PUT", "/admin/species/"+sp+"/sensitive", other, `{"sensitive":true}`); code != 403 {
		t.Fatalf("member: %d", code)
	}
	if code, _ := call("PUT", "/admin/species/"+sp+"/sensitive", admin, `{"sensitive":true,"km":30}`); code != 400 {
		t.Fatalf("bad level: %d", code)
	}
	_, o := call("POST", "/observations", admin, `{"species_id":`+sp+`,"observed_at":"`+time.Now().UTC().Format(time.RFC3339)+`","lat":8.4844,"lng":-13.2344}`)
	oid := strconv.Itoa(int(o["id"].(float64)))

	for _, tc := range []struct {
		km   string
		want [2]float64
	}{{"55", [2]float64{8.25, -13.25}}, {"22", [2]float64{8.5, -13.3}}} { // in order: the list check below expects 22
		km, want := tc.km, tc.want
		if code, _ := call("PUT", "/admin/species/"+sp+"/sensitive", admin, `{"sensitive":true,"km":`+km+`}`); code != 204 {
			t.Fatalf("set %s km: %d", km, code)
		}
		if _, v := call("GET", "/observations/"+oid, other, ""); v["lat"] != want[0] || v["lng"] != want[1] || v["obscured"] != true {
			t.Errorf("%s km: others see %v, %v", km, v["lat"], v["lng"])
		}
	}
	_, list := call("GET", "/admin/sensitive", admin, "")
	found := false
	for _, it := range list["items"].([]any) {
		m := it.(map[string]any)
		found = found || (int64(m["id"].(float64)) == sid && m["km"].(float64) == 22)
	}
	if !found {
		t.Error("species missing from the sensitive list")
	}
	if _, s := call("GET", "/species/"+sp, "", ""); s["sensitive"] != true || s["obscure_km"].(float64) != 22 {
		t.Errorf("species page: %v %v", s["sensitive"], s["obscure_km"])
	}
	call("PUT", "/admin/species/"+sp+"/sensitive", admin, `{"sensitive":false}`)
	if _, v := call("GET", "/observations/"+oid, other, ""); v["obscured"] != false {
		t.Error("still obscured after un-marking")
	}
}

func TestSightingsMap(t *testing.T) {
	call, email := apiTest(t)
	db := testDB(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	tok := out["token"].(string)
	var sid int64
	db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = 'Aptenodytes forsteri'`).Scan(&sid)
	t.Cleanup(func() {
		db.Exec(context.Background(), `UPDATE species SET sensitive = false, obscure_cell = 0.1 WHERE id = $1`, sid)
	})
	sp := strconv.FormatInt(sid, 10)
	at := time.Now().UTC().Format(time.RFC3339)
	for _, ll := range []string{`"lat":8.4844,"lng":-13.2344`, `"lat":8.4901,"lng":-13.2399`, `"lat":7.9,"lng":-11.71`} {
		if code, _ := call("POST", "/observations", tok, `{"species_id":`+sp+`,"observed_at":"`+at+`",`+ll+`}`); code != 201 {
			t.Fatalf("post: %d", code)
		}
	}
	squares := func() map[[2]float64][2]float64 { // centre -> cell, n; only this test's squares
		_, m := call("GET", "/species/"+sp+"/sightings-map", "", "")
		got := map[[2]float64][2]float64{}
		for _, it := range m["items"].([]any) {
			q := it.(map[string]any)
			got[[2]float64{q["lat"].(float64), q["lng"].(float64)}] = [2]float64{q["cell"].(float64), q["n"].(float64)}
		}
		return got
	}
	near := func(got map[[2]float64][2]float64, lat, lng, cell, n float64) bool {
		for c, v := range got {
			if math.Abs(c[0]-lat) < 1e-6 && math.Abs(c[1]-lng) < 1e-6 && v[0] == cell && v[1] >= n {
				return true
			}
		}
		return false
	}
	_, m := call("GET", "/species/"+sp+"/sightings-map", "", "")
	if ms := m["months"].([]any); len(ms) != 12 || ms[time.Now().UTC().Month()-1].(float64) < 3 {
		t.Fatalf("months: %v", ms)
	}
	got := squares()
	if !near(got, 8.475, -13.225, 0.05, 2) || !near(got, 7.925, -11.725, 0.05, 1) {
		t.Fatalf("5 km squares: %v", got)
	}
	db.Exec(t.Context(), `UPDATE species SET sensitive = true, obscure_cell = 0.5 WHERE id = $1`, sid)
	if got := squares(); !near(got, 8.25, -13.25, 0.5, 2) || near(got, 8.475, -13.225, 0.05, 1) {
		t.Fatalf("sensitive squares: %v", got)
	}
}
