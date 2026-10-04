package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/slbirdwatch/backend/internal/database"
)

func TestStreakNudge(t *testing.T) {
	day := func(n int) time.Time { return time.Date(2026, 1, n, 0, 0, 0, 0, time.UTC) }
	st := streak{Current: 5, Freezes: 1}
	seen := map[string]bool{}
	for n := 1; n <= 4; n++ {
		title, body := streakNudge(st, 7, day(n))
		if title == "" || body == "" {
			t.Fatalf("day %d: empty nudge", n)
		}
		seen[title] = true
	}
	if len(seen) != 4 { // four nights running, four different wordings
		t.Errorf("wording repeats within four days: %v", seen)
	}
	if a, _ := streakNudge(st, 7, day(1)); a == func() string { b, _ := streakNudge(st, 8, day(1)); return b }() {
		t.Errorf("two people got the same wording on the same day: %q", a)
	}
	if title, _ := streakNudge(streak{Current: 5}, 7, day(1)); title != "Your 5-day streak ends tonight" {
		t.Errorf("no freezes left: %q", title)
	}
}

func TestReminders(t *testing.T) {
	var mu sync.Mutex
	var sent []pushMessage
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var msgs []pushMessage
		json.NewDecoder(r.Body).Decode(&msgs)
		mu.Lock()
		sent = append(sent, msgs...)
		mu.Unlock()
		tickets := make([]map[string]any, len(msgs))
		for i := range tickets {
			tickets[i] = map[string]any{"status": "ok"}
		}
		json.NewEncoder(w).Encode(map[string]any{"data": tickets})
	}))
	defer fake.Close()
	old := pushURL
	pushURL = fake.URL
	t.Cleanup(func() { pushURL = old })

	call, email := apiTest(t)
	db := testDB(t)
	cache, _ := database.OpenRedis()
	a := &Server{db: db, cache: cache}
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	tok := out["token"].(string)
	phone := "ExponentPushToken[rem-" + email + "]"
	call("POST", "/me/push-token", tok, `{"token":"`+phone+`"}`)
	var me int64
	db.QueryRow(t.Context(), `SELECT id FROM users WHERE email = $1`, email).Scan(&me)

	mine := func() []pushMessage { // what reached this test's phone since the last look
		mu.Lock()
		defer mu.Unlock()
		var out []pushMessage
		for _, m := range sent {
			if m.To == phone {
				out = append(out, m)
			}
		}
		sent = nil
		return out
	}
	at := func(s string) time.Time { v, _ := time.Parse("2006-01-02 15:04", s); return v }
	run := func(now string) []pushMessage {
		if err := a.runReminders(t.Context(), at(now)); err != nil {
			t.Fatal(err)
		}
		return mine()
	}

	// Monday 2020-01-06: before 08:00 nothing, then the week's challenges once.
	if got := run("2020-01-06 07:00"); len(got) != 0 {
		t.Fatalf("too early: %v", got)
	}
	if got := run("2020-01-06 08:15"); len(got) != 1 || got[0].Title != "New weekly challenges" || got[0].Data["url"] != "/learn" {
		t.Fatalf("challenges: %+v", got)
	}
	if got := run("2020-01-06 09:00"); len(got) != 0 {
		t.Fatalf("sent twice: %v", got)
	}

	// Quizzed Mon and Tue, not yet Wed: an evening nudge on Wednesday, once.
	db.Exec(t.Context(), `INSERT INTO quiz_days (user_id, day, correct) VALUES ($1, '2020-01-06', 1), ($1, '2020-01-07', 2)`, me)
	if got := run("2020-01-08 12:00"); len(got) != 0 {
		t.Fatalf("quiz nudge before 18:00: %v", got)
	}
	got := run("2020-01-08 18:30")
	if wantTitle, wantBody := streakNudge(streak{Current: 2, Freezes: 2}, me, at("2020-01-08 00:00")); len(got) != 1 ||
		got[0].Data["url"] != "/quiz" || got[0].Title != wantTitle || got[0].Body != wantBody {
		t.Fatalf("quiz streak: %+v", got)
	}
	if got := run("2020-01-08 21:00"); len(got) != 0 {
		t.Fatalf("quiz nudge twice: %v", got)
	}

	// Missed Wednesday and Thursday: both freezes are spent, so Friday's nudge says it's the last chance.
	if got := run("2020-01-10 18:30"); len(got) != 1 || got[0].Title != "Your 2-day streak ends tonight" {
		t.Fatalf("last chance: %+v", got)
	}
	// A third missed day ends the run: nothing to save, no nudge.
	if got := run("2020-01-11 18:30"); len(got) != 0 {
		t.Fatalf("nudge for a dead streak: %v", got)
	}

	// Out last week, not yet this week: a Saturday nudge.
	db.Exec(t.Context(), `INSERT INTO outings (user_id, client_id, started_at) VALUES ($1, 'rem', '2020-01-01 07:00')`, me)
	if got := run("2020-01-11 10:00"); len(got) != 1 || got[0].Title != "Time for a walk?" || !strings.HasPrefix(got[0].Body, "You’ve been out 1 week in a row") {
		t.Fatalf("outing: %+v", got)
	}

	// Switched off: nothing.
	call("PATCH", "/me", tok, `{"notify_reminders":false}`)
	db.Exec(t.Context(), `INSERT INTO quiz_days (user_id, day, correct) VALUES ($1, '2020-02-03', 1), ($1, '2020-02-04', 1)`, me)
	if got := run("2020-02-05 19:00"); len(got) != 0 {
		t.Fatalf("reminders off: %v", got)
	}
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM challenges WHERE week < '2021-01-01'`) })
}
