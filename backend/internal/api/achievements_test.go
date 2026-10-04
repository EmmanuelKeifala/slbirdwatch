package api

import (
	"context"
	"testing"
	"time"
)

func TestRuns(t *testing.T) {
	d := func(s string) time.Time { v, _ := time.Parse("2006-01-02", s); return v }
	next := func(t time.Time) time.Time { return t.AddDate(0, 0, 1) }
	days := []time.Time{d("2026-09-01"), d("2026-09-02"), d("2026-09-03"), d("2026-09-10"), d("2026-09-11")}
	if s := runs(days, d("2026-09-12"), next); s.Current != 2 || s.Best != 3 { // yesterday still counts
		t.Errorf("ongoing: %+v", s)
	}
	if s := runs(days, d("2026-09-13"), next); s.Current != 0 || s.Best != 3 {
		t.Errorf("broken: %+v", s)
	}
	if s := runs(nil, d("2026-09-13"), next); s.Current != 0 || s.Best != 0 {
		t.Errorf("empty: %+v", s)
	}
	if w := week(d("2026-09-27")); !w.Equal(d("2026-09-21")) { // a Sunday belongs to the Monday before
		t.Errorf("week: %v", w)
	}
}

func TestQuizStreak(t *testing.T) {
	d := func(s string) time.Time { v, _ := time.Parse("2006-01-02", s); return v }
	days := func(ss ...string) (out []time.Time) {
		for _, s := range ss {
			out = append(out, d(s))
		}
		return
	}
	check := func(name string, got, want streak) {
		t.Helper()
		if got != want {
			t.Errorf("%s: got %+v, want %+v", name, got, want)
		}
	}
	check("no play", quizStreak(nil, d("2026-09-13")), streak{Freezes: 2})
	// played yesterday, not yet today: nothing missed
	check("ongoing", quizStreak(days("2026-09-10", "2026-09-11"), d("2026-09-12")), streak{Current: 2, Best: 2, Freezes: 2})
	// one day missed in the middle: a freeze bridges it, and the frozen day doesn't count
	check("bridged", quizStreak(days("2026-09-01", "2026-09-02", "2026-09-04"), d("2026-09-04")), streak{Current: 3, Best: 3, Freezes: 1, Bridged: 1})
	// missed yesterday, today still open: the run is alive on a freeze
	check("frozen now", quizStreak(days("2026-09-01", "2026-09-02"), d("2026-09-04")), streak{Current: 2, Best: 2, Freezes: 1, Frozen: 1})
	// two missed days use both freezes; a third ends it
	check("both used", quizStreak(days("2026-09-01", "2026-09-02"), d("2026-09-05")), streak{Current: 2, Best: 2, Freezes: 0, Frozen: 2})
	check("broken", quizStreak(days("2026-09-01", "2026-09-02"), d("2026-09-06")), streak{Best: 2, Freezes: 2})
	// a gap too wide for the freezes held starts a new run and leaves them unspent
	check("new run", quizStreak(days("2026-09-01", "2026-09-10", "2026-09-11"), d("2026-09-11")), streak{Current: 2, Best: 2, Freezes: 2})
	// a freeze spent early is earned back by the 7th day played
	wk := days("2026-09-01", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07")
	check("before 7", quizStreak(wk, d("2026-09-07")), streak{Current: 6, Best: 6, Freezes: 1})
	check("earned back", quizStreak(append(wk, d("2026-09-08")), d("2026-09-08")), streak{Current: 7, Best: 7, Freezes: 2})
}

func TestAchievements(t *testing.T) {
	call, email := apiTest(t)
	db := testDB(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	tok := out["token"].(string)
	var me, crow int64
	db.QueryRow(t.Context(), `SELECT id FROM users WHERE email = $1`, email).Scan(&me)
	db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = 'Aptenodytes forsteri'`).Scan(&crow) // not a Sierra Leone bird: rare here

	get := func() (map[string]map[string]any, map[string]any) {
		_, a := call("GET", "/me/achievements", tok, "")
		byKey := map[string]map[string]any{}
		for _, b := range a["badges"].([]any) {
			m := b.(map[string]any)
			byKey[m["key"].(string)] = m
		}
		return byKey, a["streaks"].(map[string]any)
	}
	if b, _ := get(); b["first_sighting"]["earned"] != false || b["species_10"]["goal"].(float64) != 10 {
		t.Fatalf("new member: %v", b["first_sighting"])
	}
	db.Exec(t.Context(), `INSERT INTO observations (user_id, species_id, community_species_id, observed_at, location, status)
		VALUES ($1, $2, $2, now(), 'POINT(-13.2 8.4)', 'verified')`, me, crow)
	// quizzed today, yesterday and the day before; out this week and last week
	db.Exec(t.Context(), `INSERT INTO quiz_days (user_id, day, correct) SELECT $1, current_date - g, 3 FROM generate_series(0, 2) g`, me)
	db.Exec(t.Context(), `INSERT INTO outings (user_id, client_id, started_at) VALUES ($1, 'a', now()), ($1, 'b', now() - interval '7 days')`, me)
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM outings WHERE user_id = $1`, me) })

	b, s := get()
	for _, k := range []string{"first_sighting", "rare_bird", "outing_1"} {
		if b[k]["earned"] != true {
			t.Errorf("%s not earned: %v", k, b[k])
		}
	}
	if b["species_10"]["progress"].(float64) != 1 || b["species_10"]["earned"] != false {
		t.Errorf("species_10: %v", b["species_10"])
	}
	if q := s["daily_quiz"].(map[string]any); q["current"].(float64) != 3 || q["best"].(float64) != 3 || q["freezes"].(float64) != maxFreezes {
		t.Errorf("quiz streak: %v", q)
	}
	if o := s["weekly_outing"].(map[string]any); o["current"].(float64) != 2 {
		t.Errorf("outing streak: %v", o)
	}
}
