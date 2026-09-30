package main

import (
	"context"
	"testing"
	"time"
)

func TestEvents(t *testing.T) {
	call, email := apiTest(t)
	db := testDB(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	ada := out["token"].(string)
	_, out = call("POST", "/auth/signup", "", creds("a-"+email, "correct horse", "Admin"))
	admin := out["token"].(string)
	t.Cleanup(func() {
		db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, "a-"+email)
		db.Exec(context.Background(), `DELETE FROM events WHERE slug = 'test-big-day'`)
	})
	db.Exec(t.Context(), `UPDATE users SET role = 'admin' WHERE email = $1`, "a-"+email)
	var adaID int64
	db.QueryRow(t.Context(), `SELECT id FROM users WHERE email = $1`, email).Scan(&adaID)

	start := time.Now().UTC().Add(-2 * time.Hour).Truncate(time.Second)
	body := `{"title":"Test Big Day","description":"Count everything.","starts_at":"` + start.Format(time.RFC3339) + `","ends_at":"` + start.Add(24*time.Hour).Format(time.RFC3339) + `"}`
	if code, _ := call("PUT", "/admin/events/test-big-day", ada, body); code != 403 {
		t.Fatalf("member: %d", code)
	}
	if code, _ := call("PUT", "/admin/events/test-big-day", admin, `{"title":"Bad","starts_at":"2026-01-02T00:00:00Z","ends_at":"2026-01-01T00:00:00Z"}`); code != 400 {
		t.Errorf("end before start: %d", code)
	}
	if code, _ := call("PUT", "/admin/events/test-big-day", admin, body); code != 204 {
		t.Fatalf("create: %d", code)
	}
	// two agreed species during the event, one sighting still needing an ID, one from before it
	db.Exec(t.Context(), `INSERT INTO observations (user_id, species_id, community_species_id, observed_at, location, status)
		SELECT $1, s.id, CASE WHEN st = 'needs_id' THEN NULL ELSE s.id END, t, 'POINT(-13.2 8.4)', st::observation_status
		FROM (VALUES ('Corvus albus', 'verified', $2::timestamptz), ('Pycnonotus barbatus', 'community', $2), ('Streptopelia semitorquata', 'needs_id', $2),
		             ('Streptopelia semitorquata', 'verified', $2 - interval '1 day')) v (sci, st, t)
		JOIN species s ON s.scientific_name = v.sci`, adaID, start.Add(time.Hour))

	_, v := call("GET", "/events/test-big-day", ada, "")
	e := v["event"].(map[string]any)
	if e["species"].(float64) != 2 || e["mine"].(float64) != 2 || e["people"].(float64) < 1 {
		t.Fatalf("event counts: %v", e)
	}
	if len(v["species_list"].([]any)) != 2 || len(v["top"].([]any)) < 1 {
		t.Errorf("species / top: %v %v", v["species_list"], v["top"])
	}
	_, list := call("GET", "/events", "", "")
	found := false
	for _, it := range list["items"].([]any) {
		m := it.(map[string]any)
		found = found || (m["slug"] == "test-big-day" && m["mine"] == nil)
	}
	if !found {
		t.Error("event not listed for guests")
	}
	_, a := call("GET", "/me/achievements", ada, "")
	earned := false
	for _, b := range a["badges"].([]any) {
		m := b.(map[string]any)
		earned = earned || (m["key"] == "big_day" && m["earned"] == true)
	}
	if !earned {
		t.Error("Big Day birder badge not earned")
	}
	if code, _ := call("GET", "/events/nope", "", ""); code != 404 {
		t.Errorf("unknown event: %d", code)
	}
}
