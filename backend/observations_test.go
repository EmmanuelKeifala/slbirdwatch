package main

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"testing"
	"time"
)

func TestObservations(t *testing.T) {
	call, email := apiTest(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	token := out["token"].(string)
	_, out = call("POST", "/auth/signup", "", creds("other-"+email, "correct horse", "Bo"))
	other := out["token"].(string)
	t.Cleanup(func() { call("DELETE", "/me", other, `{"password":"correct horse"}`) })

	// Pied Crow from the seed; extinct = Dodo.
	_, crows := call("GET", "/species?q=pied+crow&limit=1", "", "")
	crowID := crows["items"].([]any)[0].(map[string]any)["id"].(float64)
	now := time.Now().UTC().Format(time.RFC3339)

	for name, body := range map[string]string{
		"no location":                `{"observed_at":"` + now + `"}`,
		"bad lat":                    `{"observed_at":"` + now + `","lat":95,"lng":0}`,
		"future":                     `{"observed_at":"` + time.Now().Add(time.Hour).UTC().Format(time.RFC3339) + `","lat":8.48,"lng":-13.23}`,
		"no time":                    `{"lat":8.48,"lng":-13.23}`,
		"count 0":                    `{"observed_at":"` + now + `","lat":8.48,"lng":-13.23,"count":0}`,
		"bad species":                `{"observed_at":"` + now + `","lat":8.48,"lng":-13.23,"species_id":999999999}`,
		"extinct":                    `{"observed_at":"` + now + `","lat":8.48,"lng":-13.23,"species_id":` + dodoID(t) + `}`,
		"confidence without species": `{"observed_at":"` + now + `","lat":8.48,"lng":-13.23,"confidence":"certain"}`,
		"bad confidence":             `{"observed_at":"` + now + `","lat":8.48,"lng":-13.23,"species_id":1,"confidence":"sure"}`,
	} {
		if code, out := call("POST", "/observations", token, body); code != http.StatusBadRequest {
			t.Errorf("%s: %d %v", name, code, out)
		}
	}
	if code, _ := call("POST", "/observations", "", `{}`); code != http.StatusUnauthorized {
		t.Fatalf("anonymous create: %d", code)
	}

	code, o := call("POST", "/observations", token, fmt.Sprintf(
		`{"species_id":%v,"observed_at":"%s","lat":8.4844,"lng":-13.2344,"accuracy_m":12,"count":3,"notes":"  pair on the roof  ","confidence":"likely"}`, crowID, now))
	if code != http.StatusCreated {
		t.Fatalf("create: %d %v", code, o)
	}
	sp := o["species"].(map[string]any)
	if sp["english_name"] != "Pied Crow" || o["lat"].(float64) != 8.4844 || o["lng"].(float64) != -13.2344 ||
		o["count"].(float64) != 3 || o["notes"] != "pair on the roof" || o["confidence"] != "likely" {
		t.Fatalf("created: %v", o)
	}
	id := strconv.Itoa(int(o["id"].(float64)))

	code, u := call("POST", "/observations", token, `{"observed_at":"`+now+`","lat":8.48,"lng":-13.23}`)
	if code != http.StatusCreated || u["species"] != nil || u["count"].(float64) != 1 || u["confidence"] != "" {
		t.Fatalf("unknown species: %d %v", code, u)
	}

	_, mine := call("GET", "/me/observations", token, "")
	if n := len(mine["items"].([]any)); n != 2 || mine["total"].(float64) != 2 {
		t.Fatalf("my observations: %d items, total %v", n, mine["total"])
	}
	if code, _ := call("GET", "/observations/"+id, token, ""); code != http.StatusOK {
		t.Fatalf("owner get: %d", code)
	}
	// Public view: anyone can read it; not sensitive, so exact coordinates.
	for name, tok := range map[string]string{"other user": other, "guest": ""} {
		code, v := call("GET", "/observations/"+id, tok, "")
		if code != http.StatusOK || v["lat"].(float64) != 8.4844 || v["obscured"] != false {
			t.Fatalf("%s view: %d %v", name, code, v)
		}
		if obs := v["observer"].(map[string]any); obs["display_name"] != "Ada" {
			t.Fatalf("observer: %v", obs)
		}
	}

	// OBS-14: once Pied Crow is sensitive, only the observer and verifiers+ see exact coordinates.
	db := testDB(t)
	db.Exec(t.Context(), `UPDATE species SET sensitive = true WHERE scientific_name = 'Corvus albus'`)
	t.Cleanup(func() {
		db.Exec(context.Background(), `UPDATE species SET sensitive = false WHERE scientific_name = 'Corvus albus'`)
	})
	for name, tok := range map[string]string{"other user": other, "guest": ""} {
		_, v := call("GET", "/observations/"+id, tok, "")
		if v["lat"].(float64) != 8.45 || v["lng"].(float64) != -13.25 || v["obscured"] != true || v["accuracy_m"] != nil {
			t.Fatalf("%s sees sensitive location: %v %v obscured=%v acc=%v", name, v["lat"], v["lng"], v["obscured"], v["accuracy_m"])
		}
	}
	if _, v := call("GET", "/observations/"+id, token, ""); v["lat"].(float64) != 8.4844 || v["obscured"] != false {
		t.Fatalf("observer should see exact: %v", v["lat"])
	}
	_, me := call("GET", "/me", other, "")
	db.Exec(t.Context(), `UPDATE users SET role = 'verifier' WHERE id = $1`, int64(me["id"].(float64)))
	if _, v := call("GET", "/observations/"+id, other, ""); v["lat"].(float64) != 8.4844 {
		t.Fatalf("verifier should see exact: %v", v["lat"])
	}
	if _, theirs := call("GET", "/me/observations", other, ""); len(theirs["items"].([]any)) != 0 {
		t.Fatal("other user's list leaks observations")
	}

	_, exp := call("GET", "/me/export", token, "")
	if n := len(exp["observations"].([]any)); n != 2 {
		t.Fatalf("export observations: %d", n)
	}
	call("DELETE", "/me", token, `{"password":"correct horse"}`)
	if code, _ := call("GET", "/observations/"+id, token, ""); code != http.StatusNotFound {
		t.Fatalf("observation should be gone with its account: %d", code)
	}
}

func dodoID(t *testing.T) string {
	t.Helper()
	db := testDB(t)
	var id int64
	if err := db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = 'Raphus cucullatus'`).Scan(&id); err != nil {
		t.Fatalf("dodo: %v", err)
	}
	return strconv.FormatInt(id, 10)
}

func TestCreateObservationIsIdempotent(t *testing.T) {
	call, email := apiTest(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	token := out["token"].(string)
	body := `{"client_id":"phone-123","observed_at":"` + time.Now().UTC().Format(time.RFC3339) + `","lat":8.48,"lng":-13.23}`
	code1, a := call("POST", "/observations", token, body)
	code2, b := call("POST", "/observations", token, body) // the retry after a lost response
	if code1 != 201 || code2 != 200 || a["id"] != b["id"] {
		t.Fatalf("first %d %v, retry %d %v", code1, a["id"], code2, b["id"])
	}
	if _, list := call("GET", "/me/observations", token, ""); list["total"].(float64) != 1 {
		t.Fatalf("created %v sightings, want 1", list["total"])
	}
	// Another person may use the same client id.
	_, other := call("POST", "/auth/signup", "", creds("o-"+email, "correct horse", "Bo"))
	t.Cleanup(func() { testDB(t).Exec(context.Background(), `DELETE FROM users WHERE email = $1`, "o-"+email) })
	if code, _ := call("POST", "/observations", other["token"].(string), body); code != 201 {
		t.Fatalf("other user's same client_id: %d", code)
	}
}
