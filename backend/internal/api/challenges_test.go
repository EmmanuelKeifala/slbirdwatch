package api

import (
	"context"
	"testing"
	"time"
)

func TestChallenges(t *testing.T) {
	call, email := apiTest(t)
	db := testDB(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	tok := out["token"].(string)
	_, out = call("POST", "/auth/signup", "", creds("b-"+email, "correct horse", "Bo"))
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, "b-"+email) })
	var me, other int64
	db.QueryRow(t.Context(), `SELECT id FROM users WHERE email = $1`, email).Scan(&me)
	db.QueryRow(t.Context(), `SELECT id FROM users WHERE email = $1`, "b-"+email).Scan(&other)

	// This week's three are made once and stay put.
	_, a := call("GET", "/challenges", "", "")
	_, b := call("GET", "/challenges", "", "")
	items := a["items"].([]any)
	if len(items) != 3 || items[0].(map[string]any)["kind"] != "family_photo" || items[1].(map[string]any)["id"] != b["items"].([]any)[1].(map[string]any)["id"] {
		t.Fatalf("week: %v", items)
	}

	wk := week(time.Now())
	obs := func(user int64, sci, status string, at time.Time, lng float64) int64 {
		var id int64
		db.QueryRow(t.Context(), `INSERT INTO observations (user_id, species_id, community_species_id, observed_at, location, status)
			SELECT $1, s.id, CASE WHEN $3 = 'needs_id' THEN NULL ELSE s.id END, $4, ST_MakePoint($5, 8.4)::geography, $3::observation_status
			FROM species s WHERE s.scientific_name = $2 RETURNING id`, user, sci, status, at, lng).Scan(&id)
		return id
	}
	media := func(o int64, kind string) {
		db.Exec(t.Context(), `INSERT INTO media (observation_id, kind, key, thumb_key, licence) VALUES ($1, $2, 'k', 't', 'cc-by')`, o, kind)
	}
	at := wk.Add(30 * time.Hour) // Tuesday 06:00
	// kingfishers: two agreed species with photos, one awaiting ID, one without a photo
	media(obs(me, "Halcyon malimbica", "verified", at, -13.20), "photo")
	media(obs(me, "Halcyon leucocephala", "community", at, -13.20), "photo")
	media(obs(me, "Alcedo cristata", "needs_id", at, -13.20), "photo")
	obs(me, "Corythornis cristatus", "verified", at, -13.20)
	// a dawn recording (06:00) and an evening one
	media(obs(me, "Corvus albus", "verified", at, -13.20), "sound")
	media(obs(me, "Corvus albus", "verified", at.Add(12*time.Hour), -13.20), "sound")
	// an old spot, then this week one near it and one 5 km away
	obs(me, "Corvus albus", "verified", wk.AddDate(0, 0, -30), -13.30)
	// quiz on two days; one right ID on Bo's sighting
	db.Exec(t.Context(), `INSERT INTO quiz_days (user_id, day, correct) VALUES ($1, $2, 1), ($1, $2::date + 1, 0)`, me, wk)
	bo := obs(other, "Corvus albus", "verified", at, -13.20)
	db.Exec(t.Context(), `INSERT INTO identifications (observation_id, user_id, species_id) SELECT $1, $2, id FROM species WHERE scientific_name = 'Corvus albus'`, bo, me)

	for _, tc := range []struct {
		c    challenge
		want int
	}{
		{challenge{Week: wk, Kind: "family_photo", Param: "Alcedinidae"}, 2},
		{challenge{Week: wk, Kind: "dawn_song"}, 1},
		{challenge{Week: wk, Kind: "species_week"}, 4}, // three kingfishers (photo or not) + crow; the one awaiting ID doesn't count
		{challenge{Week: wk, Kind: "quiz_days"}, 2},
		{challenge{Week: wk, Kind: "help_ids"}, 1},
		{challenge{Week: wk.AddDate(0, 0, -7), Kind: "species_week"}, 0}, // last week
	} {
		if got, err := challengeProgress(t.Context(), db, me, tc.c); err != nil || got != tc.want {
			t.Errorf("%s %s: %d (%v), want %d", tc.c.Kind, tc.c.Week.Format("01-02"), got, err, tc.want)
		}
	}
	// This week's sightings are 11 km from the old spot: new. One next to the old spot isn't.
	if got, _ := challengeProgress(t.Context(), db, me, challenge{Week: wk, Kind: "new_site"}); got < 1 {
		t.Errorf("new_site: %d", got)
	}
	db.Exec(t.Context(), `DELETE FROM observations WHERE user_id = $1 AND observed_at >= $2`, me, wk)
	obs(me, "Corvus albus", "verified", at, -13.3001)
	if got, _ := challengeProgress(t.Context(), db, me, challenge{Week: wk, Kind: "new_site"}); got != 0 {
		t.Errorf("same old spot counted as new: %d", got)
	}

	// With the progress on the week's real challenges, the endpoint reports it for the signed-in viewer.
	if code, v := call("GET", "/challenges", tok, ""); code != 200 || v["items"].([]any)[0].(map[string]any)["goal"].(float64) != 3 {
		t.Errorf("signed in: %d %v", code, v)
	}
}
