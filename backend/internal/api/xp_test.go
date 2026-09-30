package api

import (
	"context"
	"strconv"
	"testing"
)

func TestXP(t *testing.T) {
	call, email := apiTest(t)
	db := testDB(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	tok := out["token"].(string)
	_, out = call("POST", "/auth/signup", "", creds("b-"+email, "correct horse", "Bo"))
	bo := out["token"].(string)
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, "b-"+email) })
	var me, other, crow, raven int64
	db.QueryRow(t.Context(), `SELECT id FROM users WHERE email = $1`, email).Scan(&me)
	db.QueryRow(t.Context(), `SELECT id FROM users WHERE email = $1`, "b-"+email).Scan(&other)
	db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = 'Corvus albus'`).Scan(&crow)
	db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = 'Corvus corax'`).Scan(&raven)

	xp := func() map[string]any {
		_, s := call("GET", "/me/stats", tok, "")
		return s["xp"].(map[string]any)
	}
	if x := xp(); x["xp"].(float64) != 0 || x["level_name"] != "Fledgling" {
		t.Fatalf("new member: %v", x)
	}

	// 12 verified sightings today (10 count), 2 species; plus 3 unverified ones that earn nothing yet.
	db.Exec(t.Context(), `INSERT INTO observations (user_id, species_id, community_species_id, observed_at, location, status)
		SELECT $1, sp, sp, now(), 'POINT(-13.2 8.4)', 'verified' FROM (SELECT CASE WHEN g <= 11 THEN $2::bigint ELSE $3::bigint END AS sp FROM generate_series(1, 12) g) x`, me, crow, raven)
	db.Exec(t.Context(), `INSERT INTO observations (user_id, species_id, observed_at, location) SELECT $1, $2, now(), 'POINT(-13.2 8.4)' FROM generate_series(1, 3)`, me, crow)
	// One ID on Bo's sighting, confirmed; one on Bo's other sighting, wrong.
	var o1, o2 int64
	db.QueryRow(t.Context(), `INSERT INTO observations (user_id, species_id, community_species_id, observed_at, location, status)
		VALUES ($1, $2, $2, now(), 'POINT(-13.2 8.4)', 'verified') RETURNING id`, other, crow).Scan(&o1)
	db.QueryRow(t.Context(), `INSERT INTO observations (user_id, species_id, community_species_id, observed_at, location, status)
		VALUES ($1, $2, $2, now(), 'POINT(-13.2 8.4)', 'verified') RETURNING id`, other, raven).Scan(&o2)
	db.Exec(t.Context(), `INSERT INTO identifications (observation_id, user_id, species_id) VALUES ($1, $3, $4), ($2, $3, $4)`, o1, o2, me, crow)
	// A quiz sync claiming 80 right answers: 50 count today.
	call("POST", "/me/quiz-stats", tok, `{"quizzes":8,"answered":80,"correct":80,"bestStreak":80,"missed":{}}`)

	x := xp()
	counts, today := x["counts"].(map[string]any), x["today"].(map[string]any)
	if counts["sightings"].(float64) != 10 || counts["lifers"].(float64) != 2 || counts["ids"].(float64) != 1 || counts["quiz"].(float64) != 50 {
		t.Fatalf("counts: %v", counts)
	}
	if today["sightings"].(float64) != 12 || today["quiz"].(float64) != 80 {
		t.Errorf("today: %v", today)
	}
	// 10×10 + 2×25 + 1×5 + 50×1 = 205, plus 50 per weekly challenge this activity happens to complete (GAM-01)
	want := 205 + 50*counts["challenges"].(float64)
	if x["xp"].(float64) != want || x["level_name"] != "Spotter" || x["next_at"].(float64) != 300 {
		t.Fatalf("xp: %v %v %v", x["xp"], x["level_name"], x["next_at"])
	}
	// others see it on the public profile
	if _, p := call("GET", "/users/"+strconv.FormatInt(me, 10), bo, ""); p["xp"].(float64) != want || p["level_name"] != "Spotter" {
		t.Errorf("public profile: %v %v", p["xp"], p["level_name"])
	}
}
