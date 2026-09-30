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
	if len(got) != 1 || got[0].Data["url"] != "/quiz" || got[0].Title != "Keep your 2-day quiz streak" {
		t.Fatalf("quiz streak: %+v", got)
	}
	if got := run("2020-01-08 21:00"); len(got) != 0 {
		t.Fatalf("quiz nudge twice: %v", got)
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
