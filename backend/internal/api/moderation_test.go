package api

import (
	"context"
	"strconv"
	"testing"
	"time"
)

func TestModeration(t *testing.T) {
	call, email := apiTest(t)
	db := testDB(t)
	signup := func(prefix, name string) (string, string, int64) {
		t.Helper()
		e := prefix + email
		_, out := call("POST", "/auth/signup", "", creds(e, "correct horse", name))
		t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, e) })
		return e, out["token"].(string), int64(out["user"].(map[string]any)["id"].(float64))
	}
	ownerEmail, owner, ownerID := signup("", "Ada")
	_, flagger, _ := signup("fl-", "Bo")
	_, mod, modID := signup("mod-", "Mo")
	_, other, otherID := signup("ot-", "Cy")
	db.Exec(t.Context(), `UPDATE users SET role = 'moderator' WHERE id = $1`, modID)
	sid := strconv.FormatInt(ownerID, 10)

	_, o := call("POST", "/observations", owner, `{"observed_at":"`+time.Now().UTC().Format(time.RFC3339)+`","lat":8.48,"lng":-13.23}`)
	oid := strconv.Itoa(int(o["id"].(float64)))
	call("POST", "/observations/"+oid+"/flags", flagger, `{"reason":"inappropriate","note":"rude notes"}`)
	call("POST", "/users/"+sid+"/report", flagger, `{"reason":"spam"}`)

	if _, st := call("GET", "/me/stats", owner, ""); st["sightings"].(float64) != 1 || st["species"].(float64) != 0 {
		t.Errorf("stats %v", st) // one sighting of an unknown bird
	}
	if code, _ := call("GET", "/mod/queue", flagger, ""); code != 403 {
		t.Fatalf("member queue: %d", code)
	}
	_, q := call("GET", "/mod/queue", mod, "")
	inQueue := func(list, key string, id string) map[string]any {
		for _, it := range q[list].([]any) {
			m := it.(map[string]any)
			ref := m
			if key != "" {
				ref = m[key].(map[string]any)
			}
			if strconv.Itoa(int(ref["id"].(float64))) == id {
				return m
			}
		}
		return nil
	}
	if s := inQueue("sightings", "", oid); s == nil || s["reasons"].(map[string]any)["inappropriate"].(float64) != 1 || s["notes"].([]any)[0] != "rude notes" {
		t.Fatalf("sighting not queued: %v", s)
	}
	if p := inQueue("people", "user", sid); p == nil || p["reasons"].(map[string]any)["spam"].(float64) != 1 {
		t.Fatalf("person not queued: %v", p)
	}

	for body, want := range map[string]int{`{"action":"explode"}`: 400, `{"action":"suspend","days":0}`: 400} {
		if code, _ := call("POST", "/mod/users/"+sid, mod, body); code != want {
			t.Errorf("%s: %d, want %d", body, code, want)
		}
	}
	if code, _ := call("POST", "/mod/observations/"+oid, flagger, `{"action":"hide"}`); code != 403 {
		t.Errorf("member hide: %d", code)
	}

	// Hide: gone for others and from the feed, still there for the observer and moderators; flags resolved.
	if code, _ := call("POST", "/mod/observations/"+oid, mod, `{"action":"hide","note":"notes"}`); code != 204 {
		t.Fatalf("hide: %d", code)
	}
	if code, _ := call("GET", "/observations/"+oid, other, ""); code != 404 {
		t.Errorf("hidden sighting visible to others: %d", code)
	}
	if _, got := call("GET", "/observations/"+oid, owner, ""); got["hidden"] != true {
		t.Errorf("observer should see it, marked hidden: %v", got["hidden"])
	}
	if code, _ := call("GET", "/observations/"+oid, mod, ""); code != 200 {
		t.Errorf("moderator can't open hidden sighting: %d", code)
	}
	_, feed := call("GET", "/observations?status=needs_id", other, "")
	for _, it := range feed["items"].([]any) {
		if strconv.Itoa(int(it.(map[string]any)["id"].(float64))) == oid {
			t.Error("hidden sighting in the feed")
		}
	}
	_, q = call("GET", "/mod/queue", mod, "")
	if inQueue("sightings", "", oid) != nil {
		t.Error("resolved flags still queued")
	}
	call("POST", "/mod/observations/"+oid, mod, `{"action":"restore"}`)
	if code, _ := call("GET", "/observations/"+oid, other, ""); code != 200 {
		t.Errorf("restored sighting: %d", code)
	}

	// Warn shows on /me; suspend signs out everywhere and blocks sign-in; unban lifts it; ban blocks it.
	call("POST", "/mod/users/"+sid, mod, `{"action":"warn","note":"Please keep notes about birds."}`)
	if _, me := call("GET", "/me", owner, ""); me["warning"] == nil || me["warning"].(map[string]any)["note"] != "Please keep notes about birds." {
		t.Errorf("warning not on /me: %v", me["warning"])
	}
	call("POST", "/mod/users/"+sid, mod, `{"action":"suspend","days":7}`)
	if code, _ := call("GET", "/me", owner, ""); code != 401 {
		t.Errorf("suspended session still works: %d", code)
	}
	if code, out := call("POST", "/auth/login", "", creds(ownerEmail, "correct horse", "")); code != 403 || out["code"] != "suspended" {
		t.Errorf("suspended login: %d %v", code, out)
	}
	call("POST", "/mod/users/"+sid, mod, `{"action":"unban"}`)
	if code, _ := call("POST", "/auth/login", "", creds(ownerEmail, "correct horse", "")); code != 200 {
		t.Errorf("login after unban: %d", code)
	}
	call("POST", "/mod/users/"+sid, mod, `{"action":"ban"}`)
	if code, out := call("POST", "/auth/login", "", creds(ownerEmail, "correct horse", "")); code != 403 || out["code"] != "banned" {
		t.Errorf("banned login: %d %v", code, out)
	}

	// Moderators can't act on their peers.
	db.Exec(t.Context(), `UPDATE users SET role = 'moderator' WHERE id = $1`, otherID)
	if code, _ := call("POST", "/mod/users/"+strconv.FormatInt(otherID, 10), mod, `{"action":"ban"}`); code != 403 {
		t.Errorf("moderator banned a moderator: %d", code)
	}

	// Remove deletes the sighting.
	if code, _ := call("POST", "/mod/observations/"+oid, mod, `{"action":"remove"}`); code != 204 {
		t.Fatalf("remove: %d", code)
	}
	if code, _ := call("GET", "/observations/"+oid, mod, ""); code != 404 {
		t.Errorf("removed sighting: %d", code)
	}
	if code, _ := call("POST", "/mod/observations/"+oid, mod, `{"action":"hide"}`); code != 404 {
		t.Errorf("moderate missing sighting: %d", code)
	}
	var n int
	db.QueryRow(t.Context(), `SELECT count(*) FROM moderation_actions WHERE moderator_id = $1`, modID).Scan(&n)
	if n != 7 { // hide, restore, warn, suspend, unban, ban, remove; refused actions aren't logged
		t.Errorf("logged %d actions, want 7", n)
	}
}
