package api

import (
	"net/http"
	"strconv"
	"testing"
	"time"
)

func TestPrivacySettings(t *testing.T) {
	call, email := apiTest(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	token := out["token"].(string)
	uid := strconv.Itoa(int(out["user"].(map[string]any)["id"].(float64)))
	_, out = call("POST", "/auth/signup", "", creds("other-"+email, "correct horse", "Bo"))
	other := out["token"].(string)
	t.Cleanup(func() { call("DELETE", "/me", other, `{"password":"correct horse"}`) })

	call("PATCH", "/me", token, `{"home_area":"Freetown","bio":"Sunbirds"}`)
	_, o := call("POST", "/observations", token, `{"observed_at":"`+time.Now().UTC().Format(time.RFC3339)+`","lat":8.4844,"lng":-13.2344}`)
	oid := strconv.Itoa(int(o["id"].(float64)))

	if code, u := call("PATCH", "/me", token, `{"hide_locations":true,"private_profile":true}`); code != 200 || u["hide_locations"] != true || u["private_profile"] != true {
		t.Fatalf("patch privacy: %d %v", code, u)
	}

	// Hidden locations: others get the grid cell, the observer still sees exact.
	if _, v := call("GET", "/observations/"+oid, other, ""); v["lat"].(float64) != 8.45 || v["obscured"] != true {
		t.Fatalf("other user sees exact location: %v", v["lat"])
	}
	if _, v := call("GET", "/observations/"+oid, token, ""); v["lat"].(float64) != 8.4844 {
		t.Fatalf("observer lost exact location: %v", v["lat"])
	}

	// Private profile: others see name only; the owner sees everything.
	_, p := call("GET", "/users/"+uid, other, "")
	if p["display_name"] != "Ada" || p["home_area"] != "" || p["bio"] != "" || p["private"] != true {
		t.Fatalf("private profile leaks: %v", p)
	}
	if _, p := call("GET", "/users/"+uid, token, ""); p["home_area"] != "Freetown" {
		t.Fatalf("owner can't see own profile: %v", p)
	}

	// Turning both off restores public view.
	call("PATCH", "/me", token, `{"hide_locations":false,"private_profile":false}`)
	if _, v := call("GET", "/observations/"+oid, "", ""); v["lat"].(float64) != 8.4844 {
		t.Fatalf("location still hidden after opting out: %v", v["lat"])
	}
	if code, p := call("GET", "/users/"+uid, "", ""); code != http.StatusOK || p["bio"] != "Sunbirds" {
		t.Fatalf("profile still private: %v", p)
	}
}
