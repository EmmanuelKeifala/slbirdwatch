package main

import (
	"context"
	"testing"
)

func TestSpotGame(t *testing.T) {
	call, _ := apiTest(t)
	db := testDB(t)
	// a Sierra Leone genus pair with photos, given an expert tip
	var x, y int64
	db.QueryRow(t.Context(), `
		SELECT a.id, b.id FROM species a JOIN species b ON b.genus = a.genus AND b.id > a.id
		JOIN region_species ra ON ra.species_id = a.id JOIN region_species rb ON rb.species_id = b.id
		WHERE EXISTS (SELECT 1 FROM species_images WHERE species_id = a.id AND status = 'ok')
		  AND EXISTS (SELECT 1 FROM species_images WHERE species_id = b.id AND status = 'ok') LIMIT 1`).Scan(&x, &y)
	if x == 0 {
		t.Skip("no seeded photos")
	}
	db.Exec(t.Context(), `INSERT INTO id_tips (species_id, other_species_id, text) VALUES ($1, $2, 'Test tip: look at the bill.')
		ON CONFLICT (species_id, other_species_id) DO NOTHING`, x, y)
	t.Cleanup(func() {
		db.Exec(context.Background(), `DELETE FROM id_tips WHERE species_id = $1 AND other_species_id = $2 AND text = 'Test tip: look at the bill.'`, x, y)
	})
	_, v := call("GET", "/games/spot?n=10", "", "")
	rounds := v["rounds"].([]any)
	if len(rounds) == 0 || len(rounds) > 10 {
		t.Fatalf("rounds: %d", len(rounds))
	}
	tipped := false
	for _, r := range rounds {
		m := r.(map[string]any)
		birds := m["birds"].([]any)
		a, b := birds[0].(map[string]any), birds[1].(map[string]any)
		target := m["target"].(map[string]any)["id"]
		if a["id"] == b["id"] || (target != a["id"] && target != b["id"]) || a["photo"] == "" {
			t.Fatalf("bad round: %v", m)
		}
		var same bool
		db.QueryRow(t.Context(), `SELECT (SELECT genus FROM species WHERE id = $1) = (SELECT genus FROM species WHERE id = $2)`, a["id"], b["id"]).Scan(&same)
		if !same {
			t.Errorf("not lookalikes: %v / %v", a["english_name"], b["english_name"])
		}
		tipped = tipped || m["tip"] != ""
	}
	if !tipped {
		t.Error("a pair with an expert tip should come first")
	}
}
