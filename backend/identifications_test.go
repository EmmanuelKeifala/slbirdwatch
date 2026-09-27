package main

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"
)

func TestConsensus(t *testing.T) {
	defer func(n int, f float64) { consensusMinIDs, consensusShare = n, f }(consensusMinIDs, consensusShare)
	consensusMinIDs, consensusShare = 2, 2.0/3
	t0 := time.Now()
	v := func(sp int64, verifier bool, min int) vote {
		return vote{sp, verifier, t0.Add(time.Duration(min) * time.Minute)}
	}
	cases := []struct {
		name    string
		votes   []vote
		status  string
		species int64
	}{
		{"nothing", nil, "needs_id", 0},
		{"observer only", []vote{v(1, false, 0)}, "needs_id", 0},
		{"two agree", []vote{v(1, false, 0), v(1, false, 1)}, "community", 1},
		{"two disagree", []vote{v(1, false, 0), v(2, false, 1)}, "needs_id", 0},
		{"2 of 3", []vote{v(1, false, 0), v(1, false, 1), v(2, false, 2)}, "community", 1},
		{"2 of 4 is not enough", []vote{v(1, false, 0), v(1, false, 1), v(2, false, 2), v(3, false, 3)}, "needs_id", 0},
		{"verifier wins", []vote{v(1, false, 0), v(1, false, 1), v(2, true, 2)}, "verified", 2},
		{"latest verifier wins", []vote{v(2, true, 0), v(3, true, 5), v(2, false, 9)}, "verified", 3},
	}
	for _, c := range cases {
		st, sp := consensus(c.votes)
		got := int64(0)
		if sp != nil {
			got = *sp
		}
		if st != c.status || got != c.species {
			t.Errorf("%s: got %s/%d, want %s/%d", c.name, st, got, c.status, c.species)
		}
	}
}

func TestCommunityIdentification(t *testing.T) {
	call, email := apiTest(t)
	signup := func(prefix string) (string, int64) {
		_, out := call("POST", "/auth/signup", "", creds(prefix+email, "correct horse", "user "+prefix))
		tok := out["token"].(string)
		id := int64(out["user"].(map[string]any)["id"].(float64))
		if prefix != "" {
			t.Cleanup(func() { call("DELETE", "/me", tok, `{"password":"correct horse"}`) })
		}
		return tok, id
	}
	owner, _ := signup("")
	bo, _ := signup("bo-")
	cy, _ := signup("cy-")
	ver, verID := signup("ver-")
	testDB(t).Exec(t.Context(), `UPDATE users SET role = 'verifier' WHERE id = $1`, verID)

	sp := func(q string) string {
		_, out := call("GET", "/species?q="+q+"&limit=1", "", "")
		return strconv.Itoa(int(out["items"].([]any)[0].(map[string]any)["id"].(float64)))
	}
	crow, raven := sp("pied+crow"), sp("common+bulbul") // both recorded in Sierra Leone all year (VER-08)
	now := time.Now().UTC().Format(time.RFC3339)
	_, o := call("POST", "/observations", owner, `{"species_id":`+crow+`,"observed_at":"`+now+`","lat":8.48,"lng":-13.23}`)
	id := strconv.Itoa(int(o["id"].(float64)))
	if o["status"] != "needs_id" {
		t.Fatalf("new observation status: %v", o["status"])
	}

	if code, _ := call("POST", "/observations/"+id+"/identifications", owner, `{"species_id":`+crow+`}`); code != http.StatusBadRequest {
		t.Fatalf("owner identifying own: %d", code)
	}
	if code, _ := call("POST", "/observations/"+id+"/identifications", "", `{"species_id":`+crow+`}`); code != http.StatusUnauthorized {
		t.Fatalf("guest identifying: %d", code)
	}

	// Bo agrees → community Pied Crow.
	_, o = call("POST", "/observations/"+id+"/identifications", bo, `{"species_id":`+crow+`,"reason":"white collar"}`)
	if o["status"] != "community" || o["community_species"].(map[string]any)["english_name"] != "Pied Crow" {
		t.Fatalf("after agree: %v %v", o["status"], o["community_species"])
	}
	// Cy suggests raven → 2 of 3 still Pied Crow; Bo changes to raven → 2 of 3 raven.
	call("POST", "/observations/"+id+"/identifications", cy, `{"species_id":`+raven+`}`)
	_, o = call("POST", "/observations/"+id+"/identifications", bo, `{"species_id":`+raven+`}`)
	if o["status"] != "community" || o["community_species"].(map[string]any)["english_name"] != "Common Bulbul" {
		t.Fatalf("after change: %v %v", o["status"], o["community_species"])
	}
	_, list := call("GET", "/observations/"+id+"/identifications", "", "")
	if n := len(list["items"].([]any)); n != 2 {
		t.Fatalf("current identifications: %d (a replaced ID must not count twice)", n)
	}

	// Feed and verify queue.
	_, feed := call("GET", "/observations?status=community&not_mine=1", bo, "")
	found := false
	for _, it := range feed["items"].([]any) {
		found = found || strconv.Itoa(int(it.(map[string]any)["id"].(float64))) == id
	}
	if !found {
		t.Fatal("community observation missing from feed")
	}
	if code, _ := call("GET", "/verify/queue", bo, ""); code != http.StatusForbidden {
		t.Fatalf("member reading verify queue: %d", code)
	}
	_, q := call("GET", "/verify/queue?min_lat=8&max_lat=9&min_lng=-14&max_lng=-13", ver, "")
	inBox := len(q["items"].([]any))
	_, q = call("GET", "/verify/queue?min_lat=50&max_lat=51&min_lng=0&max_lng=1", ver, "")
	if inBox == 0 || len(q["items"].([]any)) != 0 {
		t.Fatalf("verify queue bbox filter: in=%d out=%d", inBox, len(q["items"].([]any)))
	}

	// Verifier confirms Pied Crow → verified, leaves the queue; withdrawing reverts.
	_, o = call("POST", "/observations/"+id+"/identifications", ver, `{"species_id":`+crow+`}`)
	if o["status"] != "verified" || o["community_species"].(map[string]any)["english_name"] != "Pied Crow" {
		t.Fatalf("after verifier: %v %v", o["status"], o["community_species"])
	}
	// LIB-02: a verified sighting's photos appear on the species page, credited; unverified ones don't.
	photoURL := uploadTestPhoto(t, owner, id)
	_, gallery := call("GET", "/species/"+crow+"/photos", "", "")
	var credited bool
	for _, it := range gallery["items"].([]any) {
		p := it.(map[string]any)
		credited = credited || (p["url"] == photoURL && p["credit"] == "user" && p["licence"] == "cc-by-nc")
	}
	if !credited {
		t.Fatalf("verified photo missing from species gallery: %v", gallery["items"])
	}

	_, o = call("DELETE", "/observations/"+id+"/identifications", ver, "")
	_, gallery = call("GET", "/species/"+crow+"/photos", "", "")
	for _, it := range gallery["items"].([]any) {
		if it.(map[string]any)["url"] == photoURL {
			t.Fatal("photo of a no-longer-verified sighting still in the species gallery")
		}
	}
	if o["status"] != "community" {
		t.Fatalf("after verifier withdraws: %v", o["status"])
	}
	if code, _ := call("DELETE", "/observations/"+id+"/identifications", ver, ""); code != http.StatusNotFound {
		t.Fatalf("withdraw twice: %d", code)
	}

	// OBS-07: an "I don't know" sighting gets its species from the community.
	_, u := call("POST", "/observations", owner, `{"observed_at":"`+now+`","lat":8.48,"lng":-13.23}`)
	uid := strconv.Itoa(int(u["id"].(float64)))
	_, u = call("POST", "/observations/"+uid+"/identifications", bo, `{"species_id":`+crow+`}`)
	if u["status"] != "needs_id" || u["community_species"] != nil {
		t.Fatalf("one suggestion on unknown: %v %v", u["status"], u["community_species"])
	}
	_, u = call("POST", "/observations/"+uid+"/identifications", cy, `{"species_id":`+crow+`}`)
	if u["status"] != "community" || u["species"] != nil || u["community_species"].(map[string]any)["english_name"] != "Pied Crow" {
		t.Fatalf("two agreeing on unknown: %v species=%v community=%v", u["status"], u["species"], u["community_species"])
	}

	// Deleting Cy's account removes their raven vote: Pied Crow (owner) vs raven (Bo) → needs_id.
	call("DELETE", "/me", cy, `{"password":"correct horse"}`)
	if _, o = call("GET", "/observations/"+id, "", ""); o["status"] != "needs_id" {
		t.Fatalf("status after identifier deleted account: %v", o["status"])
	}

	// VER-05 flags.
	if code, _ := call("POST", "/observations/"+id+"/flags", owner, `{"reason":"wrong_id"}`); code != http.StatusBadRequest {
		t.Fatalf("flag own: %d", code)
	}
	if code, _ := call("POST", "/observations/"+id+"/flags", bo, `{"reason":"spam"}`); code != http.StatusBadRequest {
		t.Fatalf("bad reason: %d", code)
	}
	if code, _ := call("POST", "/observations/"+id+"/flags", bo, `{"reason":"captive","note":"zoo"}`); code != http.StatusCreated {
		t.Fatalf("flag: %d", code)
	}
	if code, _ := call("POST", "/observations/"+id+"/flags", bo, `{"reason":"captive"}`); code != http.StatusConflict {
		t.Fatalf("duplicate flag: %d", code)
	}
}

func TestConsensusConfigurable(t *testing.T) {
	defer func(n int, f float64) { consensusMinIDs, consensusShare = n, f }(consensusMinIDs, consensusShare)
	t0 := time.Now()
	two := []vote{{1, false, t0}, {1, false, t0}}
	consensusMinIDs = 3
	if st, _ := consensus(two); st != "needs_id" {
		t.Fatalf("min 3 IDs: %s", st)
	}
	consensusMinIDs, consensusShare = 2, 0.5
	if st, _ := consensus([]vote{{1, false, t0}, {2, false, t0}}); st != "community" {
		t.Fatalf("share 0.5 with a 1-1 split: %s", st)
	}
}

// uploadTestPhoto attaches a small JPEG to an observation and returns its URL.
func uploadTestPhoto(t *testing.T, token, observationID string) string {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, _ := mw.CreateFormFile("image", "bird.jpg")
	fw.Write(testJPEG(t, 64, 64, false))
	mw.Close()
	req := httptest.NewRequest("POST", "/observations/"+observationID+"/photos", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	testRouter(t).ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body)
	}
	return decode(rec.Body)["url"].(string)
}
