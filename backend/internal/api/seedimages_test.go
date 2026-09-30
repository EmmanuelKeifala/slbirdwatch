package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/slbirdwatch/backend/internal/database"
	"github.com/slbirdwatch/backend/internal/storage"
)

// fakeWikimedia answers the two API calls and serves the image, like en.wikipedia + Commons + upload.
func fakeWikimedia(t *testing.T, jpg []byte) *httptest.Server {
	t.Helper()
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/img.jpg" {
			w.Write(jpg)
			return
		}
		if !strings.HasPrefix(r.Header.Get("User-Agent"), "SLBirdwatch/") {
			t.Errorf("missing descriptive User-Agent: %q", r.Header.Get("User-Agent"))
		}
		titles := r.URL.Query().Get("titles")
		switch r.URL.Query().Get("prop") {
		case "pageimages":
			// "Corvus albus" normalises to itself, redirects to "Pied crow"; "Nobird x" has no image.
			json.NewEncoder(w).Encode(map[string]any{"query": map[string]any{
				"redirects": []map[string]string{{"from": "Corvus albus", "to": "Pied crow"}},
				"pages": []map[string]any{
					{"title": "Pied crow", "pageimage": "Pied_crow_(Corvus_albus).jpg"},
					{"title": "Nobird x"},
				},
			}})
		case "imageinfo":
			if !strings.Contains(titles, "File:Pied_crow_(Corvus_albus).jpg") {
				t.Errorf("imageinfo titles = %q", titles)
			}
			json.NewEncoder(w).Encode(map[string]any{"query": map[string]any{
				"normalized": []map[string]string{{"from": "File:Pied_crow_(Corvus_albus).jpg", "to": "File:Pied crow (Corvus albus).jpg"}},
				"pages": []map[string]any{{
					"title": "File:Pied crow (Corvus albus).jpg",
					"imageinfo": []map[string]any{{
						"thumburl":       srv.URL + "/img.jpg",
						"descriptionurl": "https://commons.wikimedia.org/wiki/File:Pied_crow.jpg",
						"extmetadata": map[string]any{
							"Artist":           map[string]any{"value": `<a href="https://flickr.com/x">Lip Kee &amp; Yap</a>`},
							"LicenseShortName": map[string]any{"value": "CC BY-SA 2.0"},
							"LicenseUrl":       map[string]any{"value": "https://creativecommons.org/licenses/by-sa/2.0"},
						},
					}},
				}},
			}})
		default:
			t.Errorf("unexpected request %s", r.URL)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestWikiClient(t *testing.T) {
	srv := fakeWikimedia(t, nil)
	wc := newWikiClient()
	wc.base = srv.URL
	ctx := context.Background()

	files, err := wc.pageImages(ctx, []string{"Corvus albus", "Nobird x"})
	if err != nil {
		t.Fatal(err)
	}
	if files["Corvus albus"] != "Pied_crow_(Corvus_albus).jpg" || files["Nobird x"] != "" {
		t.Fatalf("pageImages: %v", files)
	}
	info, err := wc.commonsInfo(ctx, []string{"Pied_crow_(Corvus_albus).jpg"})
	if err != nil {
		t.Fatal(err)
	}
	f, ok := info["Pied_crow_(Corvus_albus).jpg"]
	if !ok || f.Credit != "Lip Kee & Yap" || f.Licence != "CC BY-SA 2.0" || !strings.HasSuffix(f.ThumbURL, "/img.jpg") {
		t.Fatalf("commonsInfo: %+v", info)
	}
}

func TestStoreSpeciesImage(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	if err := database.Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	media, err := storage.Open(ctx)
	if err != nil {
		t.Skipf("s3 not available: %v", err)
	}
	a := &Server{db: db, media: media}
	srv := fakeWikimedia(t, testJPEG(t, 1600, 1200, true))
	wc := newWikiClient()
	wc.base = srv.URL

	// Use the Somali Ostrich and restore whatever the real seed stored for it afterwards.
	var id int64
	db.QueryRow(ctx, `SELECT id FROM species WHERE scientific_name = 'Struthio molybdophanes'`).Scan(&id)
	var saved []any
	rows, _ := db.Query(ctx, `SELECT * FROM species_images WHERE species_id = $1`, id)
	for rows.Next() {
		saved, _ = rows.Values()
	}
	rows.Close()
	db.Exec(ctx, `DELETE FROM species_images WHERE species_id = $1`, id)
	t.Cleanup(func() {
		var key, thumb *string
		db.QueryRow(ctx, `DELETE FROM species_images WHERE species_id = $1 RETURNING key, thumb_key`, id).Scan(&key, &thumb)
		for _, k := range []*string{key, thumb} {
			if k != nil {
				media.Remove(ctx, *k)
			}
		}
		if saved != nil {
			db.Exec(ctx, `INSERT INTO species_images VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, saved...)
		}
	})

	f := commonsFile{ThumbURL: srv.URL + "/img.jpg", SourceURL: "https://commons.wikimedia.org/wiki/File:X.jpg",
		Credit: "Tester", Licence: "CC BY 4.0", LicenceURL: "https://creativecommons.org/licenses/by/4.0"}
	if err := a.storeSpeciesImage(ctx, wc, id, f); err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	a.getSpecies(rec, withPath(httptest.NewRequest("GET", "/species/x", nil), "id", strconv.FormatInt(id, 10)))
	var sp speciesDetail
	json.NewDecoder(rec.Body).Decode(&sp)
	if sp.Image == nil || sp.Image.Credit != "Tester" || sp.Image.Licence != "CC BY 4.0" || !strings.HasPrefix(sp.Image.ThumbURL, "/media/species/") {
		t.Fatalf("species image: %+v", sp.Image)
	}
	rec = httptest.NewRecorder()
	media.ServeHTTP(rec, withPath(httptest.NewRequest("GET", "/", nil), "key", strings.TrimPrefix(sp.Image.URL, "/media/")))
	if rec.Code != 200 || strings.Contains(rec.Body.String(), "GPSLatitude") {
		t.Fatalf("stored image: %d", rec.Code)
	}

	// A species already looked up is never fetched again.
	a.markMissing(ctx, id)
	var status string
	db.QueryRow(ctx, `SELECT status FROM species_images WHERE species_id = $1`, id).Scan(&status)
	if status != "ok" {
		t.Fatalf("markMissing overwrote a found photo: %s", status)
	}
}
