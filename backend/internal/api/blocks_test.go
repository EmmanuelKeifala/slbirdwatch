package api

import (
	"net/http"
	"strconv"
	"testing"
	"time"
)

func TestBlockAndReportUsers(t *testing.T) {
	call, email := apiTest(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	ada := out["token"].(string)
	adaID := strconv.Itoa(int(out["user"].(map[string]any)["id"].(float64)))
	_, out = call("POST", "/auth/signup", "", creds("troll-"+email, "correct horse", "Troll"))
	troll := out["token"].(string)
	trollID := strconv.Itoa(int(out["user"].(map[string]any)["id"].(float64)))
	t.Cleanup(func() { call("DELETE", "/me", troll, `{"password":"correct horse"}`) })

	now := time.Now().UTC().Format(time.RFC3339)
	_, o := call("POST", "/observations", ada, `{"observed_at":"`+now+`","lat":8.48,"lng":-13.23}`)
	adaObs := strconv.Itoa(int(o["id"].(float64)))
	_, o = call("POST", "/observations", troll, `{"observed_at":"`+now+`","lat":8.48,"lng":-13.23}`)
	trollObs := int(o["id"].(float64))
	_, sp := call("GET", "/species?q=pied+crow&limit=1", "", "")
	crow := strconv.Itoa(int(sp["items"].([]any)[0].(map[string]any)["id"].(float64)))
	call("POST", "/observations/"+adaObs+"/identifications", troll, `{"species_id":`+crow+`,"reason":"spam spam"}`)

	inFeed := func(tok string, id int) bool {
		_, f := call("GET", "/observations?status=needs_id&not_mine=1", tok, "")
		for _, it := range f["items"].([]any) {
			if int(it.(map[string]any)["id"].(float64)) == id {
				return true
			}
		}
		return false
	}
	if !inFeed(ada, trollObs) {
		t.Fatal("setup: troll's sighting should be in Ada's feed before blocking")
	}

	if code, _ := call("PUT", "/users/"+adaID+"/block", ada, ""); code != http.StatusBadRequest {
		t.Fatalf("block self: %d", code)
	}
	if code, _ := call("PUT", "/users/"+trollID+"/block", ada, ""); code != http.StatusNoContent {
		t.Fatalf("block: %d", code)
	}
	if inFeed(ada, trollObs) {
		t.Fatal("blocked user's sighting still in feed")
	}
	if _, ids := call("GET", "/observations/"+adaObs+"/identifications", ada, ""); len(ids["items"].([]any)) != 0 {
		t.Fatal("blocked user's ID still shown")
	}
	if code, _ := call("POST", "/observations/"+adaObs+"/identifications", troll, `{"species_id":`+crow+`}`); code != http.StatusForbidden {
		t.Fatalf("blocked user identifying: %d", code)
	}
	if _, b := call("GET", "/me/blocks", ada, ""); len(b["items"].([]any)) != 1 {
		t.Fatalf("my blocks: %v", b["items"])
	}
	// Guests still see everything.
	if _, ids := call("GET", "/observations/"+adaObs+"/identifications", "", ""); len(ids["items"].([]any)) != 1 {
		t.Fatal("guest view affected by someone else's block")
	}

	if code, _ := call("DELETE", "/users/"+trollID+"/block", ada, ""); code != http.StatusNoContent || !inFeed(ada, trollObs) {
		t.Fatalf("unblock: %d", code)
	}

	if code, _ := call("POST", "/users/"+trollID+"/report", ada, `{"reason":"rude"}`); code != http.StatusBadRequest {
		t.Fatalf("bad reason: %d", code)
	}
	if code, _ := call("POST", "/users/"+trollID+"/report", ada, `{"reason":"harassment","note":"spam IDs"}`); code != http.StatusCreated {
		t.Fatalf("report: %d", code)
	}
	if code, _ := call("POST", "/users/"+trollID+"/report", ada, `{"reason":"harassment"}`); code != http.StatusConflict {
		t.Fatalf("duplicate report: %d", code)
	}
	if code, _ := call("POST", "/users/999999999/report", ada, `{"reason":"spam"}`); code != http.StatusNotFound {
		t.Fatalf("report missing user: %d", code)
	}
}
