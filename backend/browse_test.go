package main

import (
	"context"
	"net/http"
	"strconv"
	"testing"
	"time"
)

func TestBrowseFilters(t *testing.T) {
	call, email := apiTest(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	owner := out["token"].(string)
	_, out = call("POST", "/auth/signup", "", creds("bo-"+email, "correct horse", "Bo"))
	bo := out["token"].(string)
	t.Cleanup(func() { call("DELETE", "/me", bo, `{"password":"correct horse"}`) })

	_, sp := call("GET", "/species?q=pied+crow&limit=1", "", "")
	crow := strconv.Itoa(int(sp["items"].([]any)[0].(map[string]any)["id"].(float64)))
	_, o := call("POST", "/observations", owner, `{"species_id":`+crow+`,"observed_at":"`+time.Now().UTC().Format(time.RFC3339)+
		`","lat":8.48,"lng":-13.23,"features":{"habitat":"urban","size":"medium","colours":["black","white"]}}`)
	id := strconv.Itoa(int(o["id"].(float64)))

	has := func(query string) bool {
		t.Helper()
		code, res := call("GET", "/species?limit=100&"+query, "", "")
		if code != 200 {
			t.Fatalf("%s: %d %v", query, code, res)
		}
		for _, it := range res["items"].([]any) {
			if strconv.Itoa(int(it.(map[string]any)["id"].(float64))) == crow {
				return true
			}
		}
		return false
	}

	// Only community-ID/verified sightings count: not listed yet.
	if has("habitat=urban") {
		t.Fatal("needs_id sighting counted for browse")
	}
	call("POST", "/observations/"+id+"/identifications", bo, `{"species_id":`+crow+`}`) // → community
	for _, q := range []string{"habitat=urban", "size=medium", "colour=white", "habitat=urban&colour=black", "near=8.5,-13.2", "family=Corvidae&near=8.48,-13.23&radius_km=5"} {
		if !has(q) {
			t.Errorf("%s: Pied Crow missing", q)
		}
	}
	for _, q := range []string{"habitat=coast", "colour=blue", "near=51.5,-0.1", "near=8.48,-13.8&radius_km=10"} {
		if has(q) {
			t.Errorf("%s: Pied Crow wrongly listed", q)
		}
	}
	for _, q := range []string{"habitat=moon", "near=abc", "near=95,0"} {
		if code, _ := call("GET", "/species?"+q, "", ""); code != http.StatusBadRequest {
			t.Errorf("%s: %d, want 400", q, code)
		}
	}

	// Sensitive species never show up in "near me".
	db := testDB(t)
	db.Exec(t.Context(), `UPDATE species SET sensitive = true WHERE id = $1`, crow)
	t.Cleanup(func() { db.Exec(context.Background(), `UPDATE species SET sensitive = false WHERE id = $1`, crow) })
	if has("near=8.48,-13.23") {
		t.Fatal("sensitive species listed near a location")
	}

	_, fam := call("GET", "/families", "", "")
	items := fam["items"].([]any)
	first := items[0].(map[string]any)
	if len(items) < 240 || first["family_sci"] != "Struthionidae" || first["species"].(float64) != 2 {
		t.Fatalf("families: %d, first %v", len(items), first)
	}
}
