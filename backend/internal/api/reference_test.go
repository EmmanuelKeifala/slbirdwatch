package api

import (
	"bytes"
	"context"
	"fmt"
	"mime/multipart"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"
)

func TestReferencePhotos(t *testing.T) {
	call, email := apiTest(t)
	h := testRouter(t)
	db := testDB(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada Observer"))
	owner := out["token"].(string)
	_, out = call("POST", "/auth/signup", "", creds("v-"+email, "correct horse", "Vi"))
	verifier := out["token"].(string)
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, "v-"+email) })
	db.Exec(t.Context(), `UPDATE users SET role = 'verifier' WHERE email = $1`, "v-"+email)

	var sp, gid int64
	db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = 'Aptenodytes forsteri'`).Scan(&sp)
	db.QueryRow(t.Context(), `INSERT INTO species_gallery (species_id, key, thumb_key, width, height, credit, licence, licence_url, source_url, source_id)
		VALUES ($1, 'ref-k', 'ref-t', 1, 1, 'Galla', 'CC0', 'u', 'https://example.org/p', 'test:ref') RETURNING id`, sp).Scan(&gid)
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM species_gallery WHERE source_id = 'test:ref'`) })
	s := strconv.FormatInt(sp, 10)
	g := strconv.FormatInt(gid, 10)

	if code, _ := call("PUT", "/verify/reference", owner, `{"media_ref":"gallery:`+g+`","reference":true}`); code != 403 {
		t.Fatalf("member: %d", code)
	}
	if code, _ := call("PUT", "/verify/reference", verifier, `{"media_ref":"gallery:`+g+`","reference":true}`); code != 204 {
		t.Fatalf("mark gallery photo: %d", code)
	}
	_, page := call("GET", "/species/"+s, "", "")
	if img := page["image"].(map[string]any); img["credit"] != "Galla" || page["gallery"].([]any)[0].(map[string]any)["reference"] != true {
		t.Fatalf("hero %v, first gallery %v", page["image"], page["gallery"].([]any)[0])
	}

	// A community photo: only once its sighting is verified, and then it leads.
	_, o := call("POST", "/observations", owner, `{"species_id":`+s+`,"observed_at":"`+time.Now().UTC().Format(time.RFC3339)+`","lat":8.4,"lng":-13.2}`)
	oid := strconv.Itoa(int(o["id"].(float64)))
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	mw.WriteField("licence", "cc-by")
	fw, _ := mw.CreateFormFile("image", "bird.jpg")
	fw.Write(testJPEG(t, 400, 300, false))
	mw.Close()
	req := httptest.NewRequest("POST", "/observations/"+oid+"/photos", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+owner)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	pid := strconv.Itoa(int(decode(rec.Body)["id"].(float64)))
	if code, _ := call("PUT", "/verify/reference", verifier, `{"media_ref":"photo:`+pid+`","reference":true}`); code != 404 {
		t.Errorf("unverified sighting's photo: %d", code)
	}
	call("POST", "/observations/"+oid+"/identifications", verifier, `{"species_id":`+s+`}`) // → verified
	if code, _ := call("PUT", "/verify/reference", verifier, `{"media_ref":"photo:`+pid+`","reference":true}`); code != 204 {
		t.Fatalf("mark community photo: %d", code)
	}
	_, page = call("GET", "/species/"+s, "", "")
	if img := page["image"].(map[string]any); img["credit"] != "Ada Observer" || img["licence"] != "CC BY 4.0" {
		t.Errorf("community reference should lead: %v", img)
	}
	if _, ph := call("GET", "/species/"+s+"/photos", "", ""); ph["items"].([]any)[0].(map[string]any)["reference"] != true {
		t.Errorf("community photos: reference first")
	}

	// LIB-08: tags. The observer tags their own photo; a verifier tags the gallery one (its variant follows).
	if code, v := call("PUT", "/photos/tags", owner, `{"media_ref":"photo:`+pid+`","tags":["in-flight","male","male"]}`); code != 200 || fmt.Sprint(v["tags"]) != "[male in-flight]" {
		t.Fatalf("owner tags own photo: %d %v", code, v)
	}
	if code, _ := call("PUT", "/photos/tags", owner, `{"media_ref":"photo:`+pid+`","tags":["male","female"]}`); code != 400 {
		t.Errorf("male+female: %d", code)
	}
	if code, _ := call("PUT", "/photos/tags", owner, `{"media_ref":"gallery:`+g+`","tags":["breeding"]}`); code != 403 {
		t.Errorf("member tags gallery: %d", code)
	}
	if code, _ := call("PUT", "/photos/tags", verifier, `{"media_ref":"gallery:`+g+`","tags":["female","breeding"]}`); code != 200 {
		t.Fatalf("verifier tags gallery: %d", code)
	}
	_, page = call("GET", "/species/"+s, "", "")
	if gp := page["gallery"].([]any)[0].(map[string]any); gp["variant"] != "female" || fmt.Sprint(gp["tags"]) != "[female breeding]" {
		t.Errorf("gallery after tagging: %v %v", gp["variant"], gp["tags"])
	}
	if _, ph := call("GET", "/species/"+s+"/photos", "", ""); fmt.Sprint(ph["items"].([]any)[0].(map[string]any)["tags"]) != "[male in-flight]" {
		t.Errorf("community photo tags: %v", ph["items"].([]any)[0])
	}
	if code, _ := call("PUT", "/photos/tags", owner, `{"media_ref":"sound:`+pid+`","tags":["song"]}`); code != 404 {
		t.Errorf("a photo tagged as a sound: %d", code)
	}
	if code, _ := call("PUT", "/photos/tags", owner, `{"media_ref":"sound:`+pid+`","tags":["male"]}`); code != 400 {
		t.Errorf("photo tag on a sound: %d", code)
	}
	_, out = call("POST", "/auth/signup", "", creds("x-"+email, "correct horse", "Xa"))
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, "x-"+email) })
	if code, _ := call("PUT", "/photos/tags", out["token"].(string), `{"media_ref":"photo:`+pid+`","tags":[]}`); code != 404 {
		t.Errorf("someone else's photo: %d", code)
	}
}
