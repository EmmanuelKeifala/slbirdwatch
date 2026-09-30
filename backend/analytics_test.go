package main

import (
	"context"
	"fmt"
	"testing"
	"time"
)

func TestAnalytics(t *testing.T) {
	call, email := apiTest(t)
	db := testDB(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	member := out["token"].(string)
	_, out = call("POST", "/auth/signup", "", creds("a-"+email, "correct horse", "Admin"))
	admin := out["token"].(string)
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, "a-"+email) })
	db.Exec(t.Context(), `UPDATE users SET role = 'admin' WHERE email = $1`, "a-"+email)

	if code, _ := call("GET", "/admin/analytics", member, ""); code != 403 {
		t.Fatalf("member: %d", code)
	}
	get := func() map[string]any {
		code, v := call("GET", "/admin/analytics", admin, "")
		if code != 200 {
			t.Fatalf("analytics: %d %v", code, v)
		}
		return v
	}
	num := func(v map[string]any, section, key string) float64 { return v[section].(map[string]any)[key].(float64) }
	thisWeek := func(v map[string]any, section, key string) float64 {
		s := v[section].(map[string]any)[key].([]any)
		if len(s) != 8 {
			t.Fatalf("%s: %d weeks", key, len(s))
		}
		return s[7].(map[string]any)["count"].(float64)
	}
	before := get()
	if lib := before["library"].(map[string]any); lib["species"].(float64) > 0 && lib["photos3_pct"].(float64) > 100 {
		t.Errorf("library: %v", lib)
	}

	// an upload, a quiz, a flag and two anonymous bird-page views
	var sp int64
	db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = 'Corvus albus'`).Scan(&sp)
	_, o := call("POST", "/observations", member, fmt.Sprintf(`{"species_id":%d,"observed_at":"%s","lat":8.4,"lng":-13.2}`, sp, time.Now().UTC().Format(time.RFC3339)))
	call("POST", "/me/quiz-stats", member, `{"quizzes":2,"answered":20,"correct":15,"bestStreak":5,"missed":{}}`)
	call("POST", fmt.Sprintf("/observations/%d/flags", int64(o["id"].(float64))), admin, `{"reason":"wrong_id"}`)
	call("GET", fmt.Sprintf("/species/%d", sp), "", "")
	call("GET", fmt.Sprintf("/species/%d", sp), "", "")
	time.Sleep(200 * time.Millisecond) // "seen" is recorded off the request path

	after := get()
	for _, c := range []struct {
		name          string
		before, after float64
		want          float64
	}{
		{"uploads this week", thisWeek(before, "contribution", "uploads_per_week"), thisWeek(after, "contribution", "uploads_per_week"), 1},
		{"quizzes this week", thisWeek(before, "learning", "quizzes_per_week"), thisWeek(after, "learning", "quizzes_per_week"), 2},
		{"anonymous visits", num(before, "reach", "anon_today"), num(after, "reach", "anon_today"), 2},
		{"open reports", num(before, "quality", "open_reports"), num(after, "quality", "open_reports"), 1},
		{"accounts", num(before, "reach", "accounts"), num(after, "reach", "accounts"), 0},
	} {
		if c.after-c.before != c.want {
			t.Errorf("%s: %v → %v, want +%v", c.name, c.before, c.after, c.want)
		}
	}
	if num(after, "engagement", "dau") < 2 { // the member and the admin were both here today
		t.Errorf("dau: %v", after["engagement"])
	}
}
