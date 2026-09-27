package main

import (
	"fmt"
	"net/http"
	"strconv"
	"testing"
	"time"
)

func TestSites(t *testing.T) {
	call, email := apiTest(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	token := out["token"].(string)
	name := fmt.Sprintf("Lumley Beach %d", time.Now().UnixNano())
	testDB(t).Exec(t.Context(), `DELETE FROM sites WHERE name LIKE 'Lumley Beach %'`)

	if code, _ := call("POST", "/sites", "", `{"name":"x","lat":1,"lng":1}`); code != http.StatusUnauthorized {
		t.Fatalf("guest create: %d", code)
	}
	for _, bad := range []string{`{"name":"x","lat":8.47,"lng":-13.28}`, `{"name":"Somewhere","lat":95,"lng":0}`, `{"name":"Nowhere"}`} {
		if code, _ := call("POST", "/sites", token, bad); code != http.StatusBadRequest {
			t.Errorf("%s: %d", bad, code)
		}
	}
	code, s := call("POST", "/sites", token, `{"name":"  `+name+`  ","lat":8.4700,"lng":-13.2800}`)
	if code != http.StatusCreated || s["name"] != name {
		t.Fatalf("create: %d %v", code, s)
	}
	sid := strconv.Itoa(int(s["id"].(float64)))
	// Same name nearby → the existing site, not a duplicate.
	if code, again := call("POST", "/sites", token, `{"name":"`+name+`","lat":8.4705,"lng":-13.2805}`); code != 200 || again["id"] != s["id"] {
		t.Fatalf("dedupe: %d %v", code, again)
	}

	_, near := call("GET", "/sites?near=8.47,-13.27", "", "")
	found := false
	for _, it := range near["items"].([]any) {
		found = found || it.(map[string]any)["id"] == s["id"]
	}
	if !found {
		t.Fatal("site missing from nearby list")
	}
	if _, far := call("GET", "/sites?near=51.5,-0.1", "", ""); len(far["items"].([]any)) != 0 {
		t.Fatal("far-away sites listed")
	}

	now := time.Now().UTC().Format(time.RFC3339)
	if code, _ := call("POST", "/observations", token, `{"observed_at":"`+now+`","lat":9.5,"lng":-13.28,"site_id":`+sid+`}`); code != http.StatusBadRequest {
		t.Fatalf("site 100 km away accepted: %d", code)
	}
	code, o := call("POST", "/observations", token, `{"observed_at":"`+now+`","lat":8.4702,"lng":-13.2801,"site_id":`+sid+`}`)
	if code != http.StatusCreated || o["site"].(map[string]any)["name"] != name {
		t.Fatalf("observation with site: %d %v", code, o["site"])
	}
	// A hidden location hides the site name too.
	call("PATCH", "/me", token, `{"hide_locations":true}`)
	_, out = call("POST", "/auth/signup", "", creds("x-"+email, "correct horse", "X"))
	other := out["token"].(string)
	t.Cleanup(func() { call("DELETE", "/me", other, `{"password":"correct horse"}`) })
	if _, v := call("GET", "/observations/"+strconv.Itoa(int(o["id"].(float64))), other, ""); v["site"] != nil {
		t.Fatalf("site leaked on an obscured sighting: %v", v["site"])
	}
}
