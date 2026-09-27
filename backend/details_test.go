package main

import (
	"context"
	"strconv"
	"strings"
	"testing"
)

func TestParseArticle(t *testing.T) {
	extract := `The common bulbul is a songbird.

== Taxonomy and systematics ==
Described by Desfontaines.

=== Subspecies ===
P. b. inornatus lives in West Africa.

== Description ==
The common bulbul is 18–20 cm (7.1–7.9 in) in length. The sexes are similar in plumage but the male is larger. Subspecies P. b. dodsoni have yellow undertail coverts. Juveniles are paler. In non-breeding plumage it is duller.
The call is a loud doctor-quick.

== Distribution and habitat ==
A common resident breeder.

=== Breeding ===
Nests in bushes.

== References ==
Some book.`
	sections, highlights, length := parseArticle(extract)
	var titles []string
	for _, s := range sections {
		titles = append(titles, s.Title)
		if strings.Contains(s.Text, "Desfontaines") || strings.Contains(s.Text, "inornatus") || strings.Contains(s.Text, "Some book") {
			t.Errorf("skipped section leaked into %q", s.Title)
		}
	}
	if got := strings.Join(titles, "|"); got != "About|Description|Distribution and habitat|Breeding" {
		t.Errorf("sections %s", got)
	}
	if _, _, l := parseArticle("== Description ==\nIt has a wingspan of 150 cm and is 55 cm long."); l != "55 cm" {
		t.Errorf("wingspan taken as length: %q", l)
	}
	if length != "18–20 cm" {
		t.Errorf("length %q", length)
	}
	want := map[string]string{
		"Males and females": "The sexes are similar in plumage but the male is larger.",
		"Young birds":       "Juveniles are paler.",
		"Through the year":  "In non-breeding plumage it is duller.",
		"Voice":             "The call is a loud doctor-quick.",
	}
	if len(highlights) != len(want) {
		t.Fatalf("highlights %+v", highlights)
	}
	for _, h := range highlights {
		if h.Text != want[h.Title] {
			t.Errorf("%s: %q", h.Title, h.Text)
		}
	}
}

func TestSpeciesDetailsAPI(t *testing.T) {
	call, _ := apiTest(t)
	db := testDB(t)
	var id int64
	db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = 'Aptenodytes forsteri'`).Scan(&id)
	months := make([]int, 12)
	months[0] = 4
	db.Exec(t.Context(), `INSERT INTO region_species VALUES ($1, 4, $2) ON CONFLICT (species_id) DO UPDATE SET records = 4, months = $2`, id, months)
	db.Exec(t.Context(), `INSERT INTO species_details (species_id, status, source_url, sections, highlights, length_text, iucn)
		VALUES ($1, 'ok', 'https://en.wikipedia.org/wiki/Emperor_penguin', '[{"title":"Description","text":"Big."}]',
		        '[{"title":"Voice","text":"Trumpets."}]', '100–130 cm', 'NT') ON CONFLICT DO NOTHING`, id)
	t.Cleanup(func() {
		db.Exec(context.Background(), `DELETE FROM region_species WHERE species_id = $1`, id)
		db.Exec(context.Background(), `DELETE FROM species_details WHERE species_id = $1`, id)
	})

	_, sp := call("GET", "/species/"+strconv.FormatInt(id, 10), "", "")
	d, _ := sp["details"].(map[string]any)
	r, _ := sp["region"].(map[string]any)
	if d == nil || d["length"] != "100–130 cm" || d["iucn"] != "NT" || d["licence"] != "CC BY-SA 4.0" ||
		len(d["sections"].([]any)) != 1 || len(d["highlights"].([]any)) != 1 {
		t.Fatalf("details %v", d)
	}
	if r == nil || r["records"].(float64) != 4 || len(r["months"].([]any)) != 12 {
		t.Fatalf("region %v", r)
	}
	db.Exec(t.Context(), `INSERT INTO species_gallery (species_id, key, thumb_key, width, height, variant, month, credit, licence, licence_url, source_url, source_id)
		VALUES ($1, 'k1', 't1', 800, 600, '', 7, 'Jo', 'CC0', 'u', 's', 'test:1'), ($1, 'k2', 't2', 800, 600, 'female', NULL, 'Al', 'CC0', 'u', 's', 'test:2')`, id)
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM species_gallery WHERE source_id LIKE 'test:%'`) })
	_, sp = call("GET", "/species/"+strconv.FormatInt(id, 10), "", "")
	g := sp["gallery"].([]any)
	if len(g) != 2 || g[0].(map[string]any)["variant"] != "female" || g[0].(map[string]any)["month"] != nil ||
		g[1].(map[string]any)["month"].(float64) != 7 {
		t.Fatalf("gallery %v", g)
	}

	db.Exec(t.Context(), `INSERT INTO species_sound_gallery (species_id, key, spec_key, duration_ms, kind, country, month, credit, licence, licence_url, source_url, source_id)
		VALUES ($1, 'a1', 's1', 12500, 'call', 'Ghana', 8, 'Jo', 'CC BY 4.0', 'u', 's', 'test:s1'), ($1, 'a2', 's2', 3000, 'song', 'Sierra Leone', NULL, 'Al', 'CC0', 'u', 's', 'test:s2')`, id)
	t.Cleanup(func() {
		db.Exec(context.Background(), `DELETE FROM species_sound_gallery WHERE source_id LIKE 'test:%'`)
	})
	_, sp = call("GET", "/species/"+strconv.FormatInt(id, 10), "", "")
	snd := sp["sounds"].([]any)
	if len(snd) != 2 || snd[0].(map[string]any)["kind"] != "song" || snd[1].(map[string]any)["duration_s"].(float64) != 12.5 ||
		snd[1].(map[string]any)["season"] != "rainy" || snd[0].(map[string]any)["season"] != "" {
		t.Fatalf("sounds %v", snd)
	}

	// A species with neither.
	_, sp = call("GET", "/species/"+strconv.FormatInt(id+1, 10), "", "")
	if sp["details"] != nil || sp["region"] != nil || len(sp["gallery"].([]any)) != 0 || len(sp["sounds"].([]any)) != 0 {
		t.Fatalf("unexpected details/region: %v %v", sp["details"], sp["region"])
	}
}
