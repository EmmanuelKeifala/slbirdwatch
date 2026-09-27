package main

import (
	"context"
	"strconv"
	"testing"
	"time"
)

func TestSimilarAndCompare(t *testing.T) {
	call, email := apiTest(t)
	db := testDB(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	owner := out["token"].(string)
	var helpers []string
	for _, p := range []string{"a-", "b-"} {
		_, o := call("POST", "/auth/signup", "", creds(p+email, "correct horse", "Helper"))
		helpers = append(helpers, o["token"].(string))
		e := p + email
		t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, e) })
	}
	sp := func(sci string) string {
		var id int64
		db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = $1`, sci).Scan(&id)
		return strconv.FormatInt(id, 10)
	}
	crow, piapiac, houseCrow := sp("Corvus albus"), sp("Ptilostomus afer"), sp("Corvus splendens")

	// A Pied Crow sighting with field marks that two people agree on (→ Community ID), and a sighting the
	// observer called a Piapiac that someone identified as a Pied Crow: the two were confused.
	_, o := call("POST", "/observations", owner, `{"species_id":`+crow+`,"observed_at":"`+time.Now().UTC().Format(time.RFC3339)+
		`","lat":8.4,"lng":-13.2,"features":{"size":"medium","colours":["black","white"]}}`)
	oid := strconv.Itoa(int(o["id"].(float64)))
	for _, h := range helpers {
		call("POST", "/observations/"+oid+"/identifications", h, `{"species_id":`+crow+`}`)
	}
	_, o2 := call("POST", "/observations", owner, `{"species_id":`+piapiac+`,"observed_at":"`+time.Now().UTC().Format(time.RFC3339)+`","lat":8.4,"lng":-13.2}`)
	call("POST", "/observations/"+strconv.Itoa(int(o2["id"].(float64)))+"/identifications", helpers[1], `{"species_id":`+crow+`}`)

	_, res := call("GET", "/species/"+crow+"/similar", "", "")
	items := res["items"].([]any)
	first := items[0].(map[string]any)
	if strconv.Itoa(int(first["id"].(float64))) != piapiac || first["reason"] != "confused" {
		t.Fatalf("first similar: %v", first)
	}
	foundGenus := false
	for _, it := range items {
		m := it.(map[string]any)
		foundGenus = foundGenus || (strconv.Itoa(int(m["id"].(float64))) == houseCrow && m["reason"] == "genus")
	}
	if !foundGenus {
		t.Errorf("House Crow (same genus) missing: %v", items)
	}

	if code, _ := call("GET", "/compare?ids="+crow, "", ""); code != 400 {
		t.Errorf("one species: %d", code)
	}
	_, cmp := call("GET", "/compare?ids="+crow+","+piapiac+","+crow, "", "") // duplicates dropped
	got := cmp["items"].([]any)
	if len(got) != 2 {
		t.Fatalf("compare items %d", len(got))
	}
	c0 := got[0].(map[string]any)
	marks := c0["marks"].([]any)
	if c0["sightings"].(float64) < 1 || len(marks) < 3 {
		t.Fatalf("crow marks %v (%v sightings)", marks, c0["sightings"])
	}
	for _, m := range marks {
		if mm := m.(map[string]any); mm["unique"] != true {
			t.Errorf("mark %v should be unique (Piapiac has none)", mm)
		}
	}
	if c0["months"] == nil {
		t.Error("Pied Crow should have Sierra Leone months")
	}
}
