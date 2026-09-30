package api

import (
	"context"
	"os"
	"strconv"
	"testing"
	"time"
)

func TestTaxonomyAdmin(t *testing.T) {
	call, email := apiTest(t)
	db := testDB(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	admin := out["token"].(string)
	_, out = call("POST", "/auth/signup", "", creds("v-"+email, "correct horse", "Vi"))
	verifier := out["token"].(string)
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, "v-"+email) })
	db.Exec(t.Context(), `UPDATE users SET role = 'admin' WHERE email = $1`, email)
	db.Exec(t.Context(), `UPDATE users SET role = 'verifier' WHERE email = $1`, "v-"+email)
	sp := func(sci string) string {
		var id int64
		db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = $1`, sci).Scan(&id)
		return strconv.FormatInt(id, 10)
	}
	adelie, gentoo, chinstrap, king, emperor := sp("Pygoscelis adeliae"), sp("Pygoscelis papua"), sp("Pygoscelis antarcticus"),
		sp("Aptenodytes patagonicus"), sp("Aptenodytes forsteri")
	t.Cleanup(func() {
		ctx := context.Background()
		db.Exec(ctx, `UPDATE species SET merged_into = NULL, split_into = '{}' WHERE id IN (`+adelie+`, `+chinstrap+`)`)
		db.Exec(ctx, `DELETE FROM species_local_names WHERE name = 'Testbird Kokoroko'`)
		db.Exec(ctx, `DELETE FROM taxonomy_changes WHERE from_species IN (`+adelie+`, `+chinstrap+`)`)
	})

	if code, _ := call("POST", "/admin/species/merge", verifier, `{"from":`+adelie+`,"into":[`+gentoo+`]}`); code != 403 {
		t.Fatalf("verifier merge: %d", code)
	}

	// Local names: added, found by search (typo too), listed on the species, removed.
	if code, _ := call("POST", "/admin/species/"+adelie+"/names", admin, `{"name":"Testbird Kokoroko","language":"KRI"}`); code != 200 {
		t.Fatalf("add name: %d", code)
	}
	for _, q := range []string{"testbird+kokoroko", "testbird+kokorko"} {
		_, res := call("GET", "/species?q="+q+"&limit=1", "", "")
		if items := res["items"].([]any); len(items) == 0 || strconv.Itoa(int(items[0].(map[string]any)["id"].(float64))) != adelie {
			t.Errorf("search %s: %v", q, res["items"])
		}
	}
	_, s := call("GET", "/species/"+adelie, "", "")
	if n := s["local_names"].([]any); len(n) != 1 || n[0].(map[string]any)["language"] != "kri" {
		t.Errorf("local names %v", n)
	}

	// Merge: sightings and IDs move, the old species disappears from lists and can't be chosen.
	_, o := call("POST", "/observations", verifier, `{"species_id":`+adelie+`,"observed_at":"`+time.Now().UTC().Format(time.RFC3339)+`","lat":8.4,"lng":-13.2}`)
	oid := strconv.Itoa(int(o["id"].(float64)))
	call("POST", "/observations/"+oid+"/identifications", admin, `{"species_id":`+adelie+`}`)
	for body, want := range map[string]int{`{"from":` + adelie + `,"into":[` + adelie + `]}`: 400, `{"from":` + adelie + `,"into":[]}`: 400} {
		if code, _ := call("POST", "/admin/species/merge", admin, body); code != want {
			t.Errorf("%s: %d", body, code)
		}
	}
	if code, _ := call("POST", "/admin/species/merge", admin, `{"from":`+adelie+`,"into":[`+gentoo+`],"note":"test lump"}`); code != 204 {
		t.Fatalf("merge: %d", code)
	}
	_, got := call("GET", "/observations/"+oid, "", "")
	if strconv.Itoa(int(got["species"].(map[string]any)["id"].(float64))) != gentoo ||
		strconv.Itoa(int(got["community_species"].(map[string]any)["id"].(float64))) != gentoo {
		t.Errorf("sighting after merge: species %v community %v", got["species"], got["community_species"])
	}
	_, s = call("GET", "/species/"+adelie, "", "")
	if m, _ := s["merged_into"].(map[string]any); m == nil || strconv.Itoa(int(m["id"].(float64))) != gentoo {
		t.Errorf("merged_into %v", s["merged_into"])
	}
	_, res := call("GET", "/species?q=adelie+penguin&limit=5", "", "")
	for _, it := range res["items"].([]any) {
		if strconv.Itoa(int(it.(map[string]any)["id"].(float64))) == adelie {
			t.Error("merged species still listed")
		}
	}
	if code, _ := call("POST", "/observations", verifier, `{"species_id":`+adelie+`,"observed_at":"`+time.Now().UTC().Format(time.RFC3339)+`","lat":8.4,"lng":-13.2}`); code != 400 {
		t.Errorf("sighting of a merged species: %d", code)
	}

	// Split: the old species stays, links to the new ones, and its verified sightings go back to verifiers.
	_, o = call("POST", "/observations", admin, `{"species_id":`+chinstrap+`,"observed_at":"`+time.Now().UTC().Format(time.RFC3339)+`","lat":8.4,"lng":-13.2}`)
	cid := strconv.Itoa(int(o["id"].(float64)))
	call("POST", "/observations/"+cid+"/identifications", verifier, `{"species_id":`+chinstrap+`}`) // → verified
	if code, _ := call("POST", "/admin/species/split", admin, `{"from":`+chinstrap+`,"into":[`+king+`]}`); code != 400 {
		t.Errorf("split into one: %d", code)
	}
	if code, _ := call("POST", "/admin/species/split", admin, `{"from":`+chinstrap+`,"into":[`+king+`,`+emperor+`]}`); code != 204 {
		t.Fatalf("split: %d", code)
	}
	_, s = call("GET", "/species/"+chinstrap, "", "")
	if len(s["split_into"].([]any)) != 2 {
		t.Errorf("split_into %v", s["split_into"])
	}
	_, q := call("GET", "/verify/queue?limit=100", verifier, "")
	found := false
	for _, it := range q["items"].([]any) {
		found = found || strconv.Itoa(int(it.(map[string]any)["id"].(float64))) == cid
	}
	if !found {
		t.Error("verified sighting of a split species not back in the verify queue")
	}
}

func TestImportLocalNames(t *testing.T) {
	db := testDB(t)
	path := t.TempDir() + "/names.csv"
	os.WriteFile(path, []byte("scientific_name,name,language\nPycnonotus barbatus,Testname Pikin,kri\nNotus realis,Nothing,men\n"), 0o600)
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM species_local_names WHERE name = 'Testname Pikin'`) })
	added, unknown, err := importLocalNames(t.Context(), db, path)
	if err != nil || added != 1 || len(unknown) != 1 || unknown[0] != "Notus realis" {
		t.Fatalf("added %d unknown %v err %v", added, unknown, err)
	}
	os.WriteFile(path, []byte("wrong,header\n"), 0o600)
	if _, _, err := importLocalNames(t.Context(), db, path); err == nil {
		t.Fatal("bad header accepted")
	}
}
