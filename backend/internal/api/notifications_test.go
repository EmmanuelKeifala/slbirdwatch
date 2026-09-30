package api

import (
	"context"
	"strconv"
	"testing"
	"time"
)

func TestNotifications(t *testing.T) {
	call, email := apiTest(t)
	db := testDB(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	owner := out["token"].(string)
	helpers := []string{}
	for _, p := range []string{"b-", "c-"} {
		_, o := call("POST", "/auth/signup", "", creds(p+email, "correct horse", "Helper"))
		helpers = append(helpers, o["token"].(string))
		e := p + email
		t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, e) })
	}
	_, sp := call("GET", "/species?q=pied+crow&limit=1", "", "")
	crow := strconv.Itoa(int(sp["items"].([]any)[0].(map[string]any)["id"].(float64)))
	sighting := func() string {
		_, o := call("POST", "/observations", owner, `{"observed_at":"`+time.Now().UTC().Format(time.RFC3339)+`","lat":8.4,"lng":-13.2}`)
		return strconv.Itoa(int(o["id"].(float64)))
	}

	// Two agreeing IDs on an unknown bird: two "identification" notifications and one "status: community".
	oid := sighting()
	for _, h := range helpers {
		call("POST", "/observations/"+oid+"/identifications", h, `{"species_id":`+crow+`}`)
	}
	_, n := call("GET", "/me/notifications", owner, "")
	kinds := map[string]int{}
	for _, it := range n["items"].([]any) {
		m := it.(map[string]any)
		kinds[m["kind"].(string)+":"+m["status"].(string)]++
	}
	if kinds["identification:"] != 2 || kinds["status:community"] != 1 || n["unread"].(float64) != 3 {
		t.Fatalf("notifications %v unread %v", kinds, n["unread"])
	}
	if first := n["items"].([]any)[0].(map[string]any); first["species"].(map[string]any)["english_name"] != "Pied Crow" {
		t.Errorf("newest %v", first)
	}

	// Mark one read, then all.
	id := strconv.Itoa(int(n["items"].([]any)[0].(map[string]any)["id"].(float64)))
	call("POST", "/me/notifications/read", owner, `{"ids":[`+id+`]}`)
	if _, n = call("GET", "/me/notifications", owner, ""); n["unread"].(float64) != 2 {
		t.Errorf("unread after one: %v", n["unread"])
	}
	call("POST", "/me/notifications/read", owner, `{}`)
	if _, n = call("GET", "/me/notifications", owner, ""); n["unread"].(float64) != 0 {
		t.Errorf("unread after all: %v", n["unread"])
	}

	// Delete one, then clear the rest.
	_, n = call("GET", "/me/notifications", owner, "")
	first := strconv.Itoa(int(n["items"].([]any)[0].(map[string]any)["id"].(float64)))
	call("DELETE", "/me/notifications/"+first, owner, "")
	if _, n = call("GET", "/me/notifications", owner, ""); len(n["items"].([]any)) != 2 {
		t.Errorf("after deleting one: %d", len(n["items"].([]any)))
	}
	call("DELETE", "/me/notifications", owner, "")
	if _, n = call("GET", "/me/notifications", owner, ""); len(n["items"].([]any)) != 0 {
		t.Errorf("after clearing: %d", len(n["items"].([]any)))
	}

	// Categories switched off: nothing new.
	if _, me := call("PATCH", "/me", owner, `{"notify_ids":false,"notify_status":false}`); me["notify_ids"] != false || me["notify_status"] != false {
		t.Fatalf("settings %v %v", me["notify_ids"], me["notify_status"])
	}
	oid = sighting()
	for _, h := range helpers {
		call("POST", "/observations/"+oid+"/identifications", h, `{"species_id":`+crow+`}`)
	}
	if _, n = call("GET", "/me/notifications", owner, ""); n["unread"].(float64) != 0 {
		t.Errorf("notified with notifications off: %v", n["unread"])
	}
}
