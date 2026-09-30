package main

import (
	"context"
	"strconv"
	"testing"
)

func TestActivity(t *testing.T) {
	call, email := apiTest(t)
	db := testDB(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	me := out["token"].(string)
	call("POST", "/auth/signup", "", creds("b-"+email, "correct horse", "Bo"))
	call("POST", "/auth/signup", "", creds("c-"+email, "correct horse", "Cy"))
	t.Cleanup(func() {
		db.Exec(context.Background(), `DELETE FROM users WHERE email = ANY($1)`, []string{"b-" + email, "c-" + email})
	})
	var boID, cyID int64
	db.QueryRow(t.Context(), `SELECT id FROM users WHERE email = $1`, "b-"+email).Scan(&boID)
	db.QueryRow(t.Context(), `SELECT id FROM users WHERE email = $1`, "c-"+email).Scan(&cyID)
	sighting := func(user int64, sci string, lng float64, status string) int64 {
		var id int64
		db.QueryRow(t.Context(), `INSERT INTO observations (user_id, species_id, community_species_id, observed_at, location, status)
			SELECT $1, id, id, now(), ST_MakePoint($3, 8.40)::geography, $4::observation_status FROM species WHERE scientific_name = $2 RETURNING id`,
			user, sci, lng, status).Scan(&id)
		return id
	}
	near := sighting(boID, "Corvus albus", -13.20, "verified")
	far := sighting(cyID, "Corvus albus", -11.00, "verified") // ~240 km east
	sighting(boID, "Corvus albus", -13.20, "needs_id")        // not verified yet
	db.Exec(t.Context(), `UPDATE species SET sensitive = true WHERE scientific_name = 'Aptenodytes forsteri'`)
	t.Cleanup(func() {
		db.Exec(context.Background(), `UPDATE species SET sensitive = false WHERE scientific_name = 'Aptenodytes forsteri'`)
	})
	secret := sighting(boID, "Aptenodytes forsteri", -13.20, "verified")

	ids := func(tok, q string) (int, map[int64]bool) {
		code, v := call("GET", "/activity?"+q, tok, "")
		got := map[int64]bool{}
		if items, ok := v["items"].([]any); ok {
			for _, it := range items {
				got[int64(it.(map[string]any)["id"].(float64))] = true
			}
		}
		return code, got
	}
	if _, got := ids("", "scope=near&lat=8.4&lng=-13.2&km=10"); !got[near] || got[far] || got[secret] {
		t.Fatalf("near: %v (want %d, not %d or sensitive %d)", got, near, far, secret)
	}
	if code, _ := ids("", "scope=following"); code != 401 {
		t.Errorf("guest following: %d", code)
	}
	if _, got := ids(me, "scope=following"); len(got) != 0 {
		t.Errorf("following nobody: %v", got)
	}
	call("PUT", "/users/"+strconv.FormatInt(cyID, 10)+"/follow", me, "")
	if _, got := ids(me, "scope=following"); !got[far] || got[near] {
		t.Errorf("following Cy: %v", got)
	}
	if _, f := call("GET", "/me/following", me, ""); len(f["items"].([]any)) != 1 {
		t.Errorf("following list: %v", f)
	}
	// blocked either way: can't follow, and they drop out
	call("PUT", "/users/"+strconv.FormatInt(cyID, 10)+"/block", me, "")
	if _, got := ids(me, "scope=following"); got[far] {
		t.Error("blocked person still in the feed")
	}
	_, out = call("POST", "/auth/signup", "", creds("d-"+email, "correct horse", "Di")) // Di blocks me, then I try to follow Di
	di := out["token"].(string)
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, "d-"+email) })
	var meID, diID int64
	db.QueryRow(t.Context(), `SELECT id FROM users WHERE email = $1`, email).Scan(&meID)
	db.QueryRow(t.Context(), `SELECT id FROM users WHERE email = $1`, "d-"+email).Scan(&diID)
	call("PUT", "/users/"+strconv.FormatInt(meID, 10)+"/block", di, "")
	if code, _ := call("PUT", "/users/"+strconv.FormatInt(diID, 10)+"/follow", me, ""); code != 404 {
		t.Errorf("follow someone who blocked me: %d", code)
	}
	if code, _ := call("DELETE", "/users/"+strconv.FormatInt(cyID, 10)+"/follow", me, ""); code != 204 {
		t.Errorf("unfollow: %d", code)
	}
	if code, _ := ids("", "scope=everything"); code != 400 {
		t.Errorf("bad scope: %d", code)
	}
}
