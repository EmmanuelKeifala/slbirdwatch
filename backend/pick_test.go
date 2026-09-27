package main

import (
	"context"
	"strconv"
	"testing"
	"time"
)

func TestSpeciesPicker(t *testing.T) {
	call, email := apiTest(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	token := out["token"].(string)

	// A made-up Sierra Leone record: Emperor Penguin, seen only in July, with a local name.
	db := testDB(t)
	var penguin int64
	db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = 'Aptenodytes forsteri'`).Scan(&penguin)
	months := make([]int, 12)
	months[6] = 10
	db.Exec(t.Context(), `INSERT INTO region_species VALUES ($1, 10, $2) ON CONFLICT (species_id) DO UPDATE SET records = 10, months = $2`, penguin, months)
	db.Exec(t.Context(), `INSERT INTO species_local_names VALUES ($1, 'Kokoroko', 'kri') ON CONFLICT DO NOTHING`, penguin)
	t.Cleanup(func() {
		db.Exec(context.Background(), `DELETE FROM region_species WHERE species_id = $1`, penguin)
		db.Exec(context.Background(), `DELETE FROM species_local_names WHERE species_id = $1`, penguin)
	})

	first := func(query, tok string) map[string]any {
		t.Helper()
		code, res := call("GET", "/species/pick?"+query, tok, "")
		items, _ := res["items"].([]any)
		if code != 200 || len(items) == 0 {
			t.Fatalf("%s: %d %v", query, code, res)
		}
		return items[0].(map[string]any)
	}
	for query, want := range map[string]string{
		"q=emperor+penguin&month=7": "likely", // July ±1 month
		"q=emperor+penguin&month=8": "likely",
		"q=emperor+penguin&month=1": "region", // in Sierra Leone, but not this season
		"q=kokoroko":                "",       // local name, any hint
		"q=kokorko&month=7":         "likely", // typo in the local name
	} {
		it := first(query, "")
		if int64(it["id"].(float64)) != penguin || (want != "" && it["hint"] != want) {
			t.Errorf("%s: got %v %v, want penguin %q", query, it["english_name"], it["hint"], want)
		}
	}
	if it := first("q=king+penguin", ""); it["hint"] != "" {
		t.Errorf("King Penguin isn't in Sierra Leone: hint %v", it["hint"])
	}

	// Recently recorded species come first for their observer, not for guests.
	_, sp := call("GET", "/species?q=pied+crow&limit=1", "", "")
	crow := strconv.Itoa(int(sp["items"].([]any)[0].(map[string]any)["id"].(float64)))
	call("POST", "/observations", token, `{"species_id":`+crow+`,"observed_at":"`+time.Now().UTC().Format(time.RFC3339)+`","lat":8.48,"lng":-13.23}`)
	if it := first("", token); strconv.Itoa(int(it["id"].(float64))) != crow || it["hint"] != "recent" {
		t.Errorf("signed in, no query: first %v %v, want Pied Crow recent", it["english_name"], it["hint"])
	}
	if it := first("q=crow", token); strconv.Itoa(int(it["id"].(float64))) != crow {
		t.Errorf("q=crow: first %v, want Pied Crow", it["english_name"])
	}
	if it := first("month=7", ""); it["hint"] == "recent" || it["hint"] == "" {
		t.Errorf("guest, no query: first hint %v", it["hint"])
	}
}

func TestLibraryShowsSierraLeoneFirst(t *testing.T) {
	call, _ := apiTest(t)
	db := testDB(t)
	var id int64
	db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = 'Aptenodytes forsteri'`).Scan(&id)
	months := make([]int, 12)
	db.Exec(t.Context(), `INSERT INTO region_species (species_id, records, months) VALUES ($1, 1000000, $2)
		ON CONFLICT (species_id) DO UPDATE SET records = 1000000`, id, months)
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM region_species WHERE species_id = $1`, id) })

	// Browsing: the most-recorded Sierra Leone bird leads, and every listed bird before the rest is local.
	_, res := call("GET", "/species?limit=5", "", "")
	items := res["items"].([]any)
	if first := items[0].(map[string]any); int64(first["id"].(float64)) != id || first["local"] != true {
		t.Fatalf("browse starts with %v", first)
	}
	// Searching keeps best-match order: an exact name beats the local favourite.
	_, res = call("GET", "/species?q=king+penguin&limit=1", "", "")
	if got := res["items"].([]any)[0].(map[string]any)["english_name"]; got != "King Penguin" {
		t.Errorf("search: %v", got)
	}
}
