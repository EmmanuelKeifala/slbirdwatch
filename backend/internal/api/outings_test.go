package api

import (
	"context"
	"strconv"
	"testing"
	"time"
)

func TestOutings(t *testing.T) {
	call, email := apiTest(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	token := out["token"].(string)
	_, out = call("POST", "/auth/signup", "", creds("o-"+email, "correct horse", "Bo"))
	other := out["token"].(string)
	t.Cleanup(func() { testDB(t).Exec(context.Background(), `DELETE FROM users WHERE email = $1`, "o-"+email) })
	start := time.Now().Add(-90 * time.Minute).UTC().Format(time.RFC3339)

	for body, want := range map[string]int{`{"started_at":"` + start + `"}`: 400, `{"client_id":"w1"}`: 400,
		`{"client_id":"w1","started_at":"` + start + `","ended_at":"2000-01-01T00:00:00Z"}`: 400} {
		if code, _ := call("POST", "/outings", token, body); code != want {
			t.Errorf("%s: %d", body, code)
		}
	}
	_, o := call("POST", "/outings", token, `{"client_id":"walk-1","started_at":"`+start+`"}`)
	id := strconv.Itoa(int(o["id"].(float64)))
	if _, again := call("POST", "/outings", token, `{"client_id":"walk-1","started_at":"`+start+`"}`); strconv.Itoa(int(again["id"].(float64))) != id {
		t.Fatal("resending the start created a second outing")
	}

	_, sp := call("GET", "/species?q=pied+crow&limit=1", "", "")
	crow := strconv.Itoa(int(sp["items"].([]any)[0].(map[string]any)["id"].(float64)))
	now := time.Now().UTC().Format(time.RFC3339)
	for i, c := range []string{"3", "2"} { // two flocks ~100 m apart (the same spot and minute would be a duplicate)
		lat := []string{"8.48", "8.481"}[i]
		if code, _ := call("POST", "/observations", token, `{"species_id":`+crow+`,"count":`+c+`,"observed_at":"`+now+`","lat":`+lat+`,"lng":-13.23,"outing_id":`+id+`}`); code != 201 {
			t.Fatalf("sighting on outing: %d", code)
		}
	}
	call("POST", "/observations", token, `{"observed_at":"`+now+`","lat":8.48,"lng":-13.23,"outing_id":`+id+`}`) // unknown bird
	if code, _ := call("POST", "/observations", other, `{"observed_at":"`+now+`","lat":8.48,"lng":-13.23,"outing_id":`+id+`}`); code != 400 {
		t.Errorf("someone else's outing: %d", code)
	}

	// End it with a route of about 1.1 km (0.01° of latitude).
	end := time.Now().UTC().Format(time.RFC3339)
	_, o = call("POST", "/outings", token, `{"client_id":"walk-1","started_at":"`+start+`","ended_at":"`+end+`","route":[[8.47,-13.23],[8.475,-13.23],[8.48,-13.23]]}`)
	if o["distance_m"].(float64) < 1050 || o["distance_m"].(float64) > 1150 || o["minutes"].(float64) < 89 || o["sightings"].(float64) != 3 {
		t.Fatalf("summary %v", o)
	}
	species := o["species"].([]any)
	if len(species) != 1 || species[0].(map[string]any)["count"].(float64) != 5 || len(o["route"].([]any)) != 3 {
		t.Fatalf("species %v route %v", species, o["route"])
	}
	if code, _ := call("GET", "/outings/"+id, other, ""); code != 404 {
		t.Errorf("other person's view: %d", code)
	}
	_, list := call("GET", "/me/outings", token, "")
	if items := list["items"].([]any); len(items) != 1 || items[0].(map[string]any)["species"].(float64) != 1 {
		t.Fatalf("my outings %v", list["items"])
	}
}
