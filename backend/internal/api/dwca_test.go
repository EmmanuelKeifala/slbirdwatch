package api

import (
	"archive/zip"
	"bytes"
	"context"
	"io"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/slbirdwatch/backend/internal/database"
)

func TestDwCA(t *testing.T) {
	call, email := apiTest(t)
	h := testRouter(t)
	db := testDB(t)
	cache, _ := database.OpenRedis()
	cache.Del(t.Context(), "gbif:dwca")
	t.Cleanup(func() { cache.Del(context.Background(), "gbif:dwca") })
	call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	call("POST", "/auth/signup", "", creds("r-"+email, "correct horse", "Rae"))
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, "r-"+email) })
	db.Exec(t.Context(), `UPDATE users SET default_licence = 'cc-by' WHERE email = $1`, email)
	db.Exec(t.Context(), `UPDATE users SET default_licence = 'all-rights-reserved' WHERE email = $1`, "r-"+email)
	ids := map[string]int64{}
	for _, who := range []string{email, "r-" + email} {
		var id int64
		db.QueryRow(t.Context(), `INSERT INTO observations (user_id, species_id, community_species_id, observed_at, location, status)
			SELECT u.id, s.id, s.id, now(), 'POINT(-13.2 8.4)', 'verified' FROM users u, species s
			WHERE u.email = $1 AND s.scientific_name = 'Corvus albus' RETURNING id`, who).Scan(&id)
		ids[who] = id
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/gbif/dwca.zip", nil))
	if rec.Code != 200 {
		t.Fatalf("archive: %d", rec.Code)
	}
	zr, err := zip.NewReader(bytes.NewReader(rec.Body.Bytes()), int64(rec.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	files := map[string]string{}
	for _, f := range zr.File {
		rc, _ := f.Open()
		b, _ := io.ReadAll(rc)
		files[f.Name] = string(b)
	}
	occ := files["occurrence.txt"]
	if !strings.HasPrefix(occ, "occurrenceID\tbasisOfRecord") {
		t.Fatalf("occurrence.txt header: %.60q", occ)
	}
	if !strings.Contains(occ, "slbirdwatch:"+strconv.FormatInt(ids[email], 10)+"\t") {
		t.Error("CC BY record missing")
	}
	if strings.Contains(occ, "slbirdwatch:"+strconv.FormatInt(ids["r-"+email], 10)+"\t") {
		t.Error("all-rights-reserved record included")
	}
	if !strings.Contains(files["meta.xml"], `term="http://rs.tdwg.org/dwc/terms/scientificName"`) || !strings.Contains(files["meta.xml"], `term="http://purl.org/dc/terms/license"`) {
		t.Error("meta.xml terms")
	}
	if !strings.Contains(files["eml.xml"], "<title xml:lang=\"en\">SL Birdwatch") || !strings.Contains(files["eml.xml"], "licenses/by") {
		t.Errorf("eml.xml: %.200s", files["eml.xml"])
	}
}
