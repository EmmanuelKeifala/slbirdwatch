package api

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/slbirdwatch/backend/internal/database"
)

func TestPack(t *testing.T) {
	h := testRouter(t)
	cache, _ := database.OpenRedis()
	cache.Del(context.Background(), "pack:sl:gz")
	get := func() (int, map[string]any, time.Duration) {
		start := time.Now()
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", "/packs/sierra-leone", nil))
		var v map[string]any
		json.NewDecoder(rec.Body).Decode(&v)
		return rec.Code, v, time.Since(start)
	}
	code, v, _ := get()
	if code != 200 {
		t.Fatalf("pack: %d", code)
	}
	sp := v["species"].([]any)
	var regional int
	testDB(t).QueryRow(t.Context(), `SELECT count(*) FROM region_species rs JOIN species s ON s.id = rs.species_id WHERE NOT s.extinct AND s.merged_into IS NULL`).Scan(&regional)
	if len(sp) != regional {
		t.Fatalf("pack has %d species, Sierra Leone has %d", len(sp), regional)
	}
	if regional > 0 {
		first := sp[0].(map[string]any)
		for _, k := range []string{"english_name", "image", "details", "region", "gallery", "sounds", "local_names"} {
			if _, ok := first[k]; !ok {
				t.Errorf("species entry lacks %s", k)
			}
		}
	}
	if code, v2, _ := get(); code != 200 || v2["version"] != v["version"] { // served from the cache
		t.Errorf("second fetch: %d, version %v vs %v", code, v2["version"], v["version"])
	}
	req := httptest.NewRequest("GET", "/packs/sierra-leone", nil) // phones ask for gzip
	req.Header.Set("Accept-Encoding", "gzip")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	zr, err := gzip.NewReader(rec.Body)
	if err != nil || rec.Header().Get("Content-Encoding") != "gzip" {
		t.Fatalf("gzip: %v %q", err, rec.Header().Get("Content-Encoding"))
	}
	var z map[string]any
	if json.NewDecoder(zr).Decode(&z); z["version"] != v["version"] {
		t.Errorf("gzipped pack: %v", z["version"])
	}
}
