package api

import (
	"context"
	"testing"
)

func TestLeaderboard(t *testing.T) {
	call, email := apiTest(t)
	db := testDB(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada Board"))
	ada := out["token"].(string)
	_, out = call("POST", "/auth/signup", "", creds("b-"+email, "correct horse", "Bo Board"))
	bo := out["token"].(string)
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, "b-"+email) })
	var adaID, boID int64
	db.QueryRow(t.Context(), `SELECT id FROM users WHERE email = $1`, email).Scan(&adaID)
	db.QueryRow(t.Context(), `SELECT id FROM users WHERE email = $1`, "b-"+email).Scan(&boID)
	// Ada: three verified crows this week near Freetown (30 + a lifer 25); Bo: 20 right quiz answers
	db.Exec(t.Context(), `INSERT INTO observations (user_id, species_id, community_species_id, observed_at, location, status)
		SELECT $1, id, id, now(), 'POINT(-13.23 8.48)', 'verified' FROM species, generate_series(1, 3) WHERE scientific_name = 'Corvus albus'`, adaID)
	call("POST", "/me/quiz-stats", bo, `{"quizzes":2,"answered":25,"correct":20,"bestStreak":9,"missed":{}}`)

	board := func(tok, q string) map[int64]map[string]any {
		_, v := call("GET", "/leaderboard?"+q, tok, "")
		got := map[int64]map[string]any{}
		for _, it := range v["items"].([]any) {
			m := it.(map[string]any)
			got[int64(m["user"].(map[string]any)["id"].(float64))] = m
		}
		return got
	}
	b := board(ada, "scope=week")
	if b[adaID] == nil || b[adaID]["xp"].(float64) != 55 || b[adaID]["me"] != true {
		t.Fatalf("Ada: %v", b[adaID])
	}
	if b[boID] == nil || b[boID]["xp"].(float64) != 20 || b[adaID]["rank"].(float64) >= b[boID]["rank"].(float64) {
		t.Fatalf("Bo: %v (Ada %v)", b[boID], b[adaID])
	}
	near := board("", "scope=near&lat=8.48&lng=-13.23")
	if near[adaID] == nil || near[boID] != nil { // Bo has no sighting there
		t.Errorf("near Freetown: %v", near)
	}
	if far := board("", "scope=near&lat=7.9&lng=-11.0"); far[adaID] != nil {
		t.Errorf("far away: %v", far[adaID])
	}
	call("PATCH", "/me", bo, `{"hide_from_leaderboards":true}`)
	db.Exec(t.Context(), `UPDATE users SET private_profile = true WHERE id = $1`, adaID)
	if b := board("", "scope=week"); b[boID] != nil || b[adaID] != nil {
		t.Errorf("opted out / private still listed: %v %v", b[boID], b[adaID])
	}
	if code, _ := call("GET", "/leaderboard?scope=near&lat=x", "", ""); code != 400 {
		t.Errorf("bad near: %d", code)
	}
}
