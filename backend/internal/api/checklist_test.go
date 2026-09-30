package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/slbirdwatch/backend/internal/database"
)

func TestAreaChecklist(t *testing.T) {
	if r := rarityOf(100, 100) + rarityOf(5, 100) + rarityOf(2, 100); r != "commonuncommonrare" {
		t.Fatalf("rarity: %s", r)
	}
	call, email := apiTest(t)
	db := testDB(t)
	cache, _ := database.OpenRedis()
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	tok := out["token"].(string)

	// two Sierra Leone birds GBIF knows, and a third seen only by the community
	var common, rare, seen, sensitive int64
	var commonKey, rareKey, sensitiveKey int64
	db.QueryRow(t.Context(), `SELECT species_id, gbif_key FROM region_species WHERE gbif_key IS NOT NULL ORDER BY species_id LIMIT 1`).Scan(&common, &commonKey)
	db.QueryRow(t.Context(), `SELECT species_id, gbif_key FROM region_species WHERE gbif_key IS NOT NULL ORDER BY species_id OFFSET 1 LIMIT 1`).Scan(&rare, &rareKey)
	db.QueryRow(t.Context(), `SELECT species_id, gbif_key FROM region_species WHERE gbif_key IS NOT NULL ORDER BY species_id OFFSET 2 LIMIT 1`).Scan(&sensitive, &sensitiveKey)
	db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = 'Corvus albus'`).Scan(&seen)
	if commonKey == 0 || sensitiveKey == 0 {
		t.Skip("region_species not seeded")
	}
	db.Exec(t.Context(), `UPDATE species SET sensitive = true WHERE id = $1`, sensitive)
	t.Cleanup(func() { db.Exec(context.Background(), `UPDATE species SET sensitive = false WHERE id = $1`, sensitive) })

	calls := 0
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		fmt.Fprintf(w, `{"facets":[{"counts":[{"name":"%d","count":200},{"name":"%d","count":3},{"name":"%d","count":50},{"name":"999999999","count":7}]}]}`,
			commonKey, rareKey, sensitiveKey)
	}))
	defer fake.Close()
	old := areaGBIF.base
	areaGBIF.base = fake.URL
	defer func() { areaGBIF.base = old }()

	lat := 7.0 + float64(time.Now().UnixNano()%1000)/10000 // a fresh spot, so the cache starts empty
	lng := -12.3
	key := fmt.Sprintf("area:%.2f,%.2f,%d", lat, lng, 5)
	cache.Del(t.Context(), key)
	t.Cleanup(func() { cache.Del(context.Background(), key) })

	_, o := call("POST", "/observations", tok, fmt.Sprintf(`{"species_id":%d,"observed_at":"%s","lat":%f,"lng":%f}`, seen, time.Now().UTC().Format(time.RFC3339), lat+0.01, lng))
	db.Exec(t.Context(), `UPDATE observations SET status = 'verified', community_species_id = $2 WHERE id = $1`, int64(o["id"].(float64)), seen)

	q := "/area/checklist?lat=" + strconv.FormatFloat(lat, 'f', 4, 64) + "&lng=-12.3&km=5"
	_, got := call("GET", q, "", "")
	byID := map[int64]map[string]any{}
	for _, it := range got["items"].([]any) {
		m := it.(map[string]any)
		byID[int64(m["id"].(float64))] = m
	}
	if got["gbif_ok"] != true || byID[common]["rarity"] != "common" || byID[common]["gbif"].(float64) != 200 || byID[rare]["rarity"] != "rare" {
		t.Fatalf("gbif birds: %v", got)
	}
	if s := byID[seen]; s == nil || s["community"].(float64) < 1 || s["last_seen"] == nil {
		t.Fatalf("community bird: %v", s)
	}
	if byID[sensitive] != nil {
		t.Error("sensitive bird listed")
	}
	call("GET", q, "", "") // second look comes from the cache
	if calls != 1 {
		t.Errorf("gbif calls: %d", calls)
	}
	if code, _ := call("GET", "/area/checklist?lat=abc&lng=1", "", ""); code != 400 {
		t.Errorf("bad lat: %d", code)
	}
}
