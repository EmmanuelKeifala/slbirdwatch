package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/slbirdwatch/backend/internal/database"
	"github.com/slbirdwatch/backend/internal/storage"
)

func TestListSpecies(t *testing.T) {
	db := testDB(t)
	if err := database.Migrate(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	media, err := storage.Open(context.Background())
	if err != nil {
		t.Skipf("s3 not available: %v", err)
	}
	a := &Server{db: db, media: media}
	h := a.listSpecies

	get := func(url string) (items []speciesItem, next *int) {
		rec := httptest.NewRecorder()
		h(rec, httptest.NewRequest("GET", url, nil))
		if rec.Code != 200 {
			t.Fatalf("%s: status %d", url, rec.Code)
		}
		var body struct {
			Items      []speciesItem `json:"items"`
			NextOffset *int          `json:"next_offset"`
		}
		json.NewDecoder(rec.Body).Decode(&body)
		return body.Items, body.NextOffset
	}

	if items, _ := get("/species?q=pied+crow&limit=1"); len(items) != 1 || items[0].ScientificName != "Corvus albus" {
		t.Fatalf("exact search: %+v", items)
	}
	if items, _ := get("/species?q=kingfshr&limit=3"); len(items) == 0 || !strings.Contains(items[0].EnglishName, "Kingfisher") {
		t.Fatalf("typo search: %+v", items)
	}
	page1, next := get("/species?family=Alcedinidae&limit=2")
	if len(page1) != 2 || next == nil || *next != 2 {
		t.Fatalf("paging: %+v next=%v", page1, next)
	}
	page2, _ := get("/species?family=Alcedinidae&limit=2&offset=2")
	if page2[0].ID == page1[0].ID {
		t.Fatal("offset did not advance")
	}

	rec := httptest.NewRecorder()
	a.getSpecies(rec, withPath(httptest.NewRequest("GET", "/species/1", nil), "id", "1"))
	var sp speciesDetail
	json.NewDecoder(rec.Body).Decode(&sp)
	if rec.Code != 200 || sp.ScientificName != "Struthio camelus" || sp.BreedingRange == "" {
		t.Fatalf("detail: %d %+v", rec.Code, sp)
	}
	rec = httptest.NewRecorder()
	a.getSpecies(rec, withPath(httptest.NewRequest("GET", "/species/0", nil), "id", "0"))
	if rec.Code != 404 {
		t.Fatalf("missing species: %d", rec.Code)
	}
}

func withPath(r *http.Request, k, v string) *http.Request {
	r.SetPathValue(k, v)
	return r
}
