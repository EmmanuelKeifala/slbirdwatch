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

	"github.com/slbirdwatch/backend/internal/storage"
)

func TestDuplicatesAndSpam(t *testing.T) {
	call, email := apiTest(t)
	h := testRouter(t)
	db := testDB(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	ada := out["token"].(string)
	_, out = call("POST", "/auth/signup", "", creds("b-"+email, "correct horse", "Bo"))
	bo := out["token"].(string)
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, "b-"+email) })

	upload := func(tok, oid string, img []byte) (int, map[string]any) {
		var body bytes.Buffer
		mw := multipart.NewWriter(&body)
		fw, _ := mw.CreateFormFile("image", "bird.jpg")
		fw.Write(img)
		mw.Close()
		req := httptest.NewRequest("POST", "/observations/"+oid+"/photos", &body)
		req.Header.Set("Content-Type", mw.FormDataContentType())
		req.Header.Set("Authorization", "Bearer "+tok)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code, decode(rec.Body)
	}
	at := time.Now().Add(-time.Hour).UTC()
	sighting := func(tok, species string, lat float64, when time.Time) (int, map[string]any) {
		sp := ""
		if species != "" {
			sp = `"species_id":` + species + `,`
		}
		return call("POST", "/observations", tok, `{`+sp+`"observed_at":"`+when.Format(time.RFC3339)+`","lat":`+fmt.Sprint(lat)+`,"lng":-13.23}`)
	}
	id := func(m map[string]any) string { return strconv.Itoa(int(m["id"].(float64))) }

	// Photos: the same picture (even re-encoded smaller) can't go on another sighting, or be taken by someone else.
	_, o1 := sighting(ada, "", 8.40, at)
	_, o2 := sighting(ada, "", 8.41, at)
	_, o3 := sighting(bo, "", 8.42, at)
	photo := testJPEG(t, 800, 600, false)
	if code, _ := upload(ada, id(o1), photo); code != 201 {
		t.Fatalf("first upload: %d", code)
	}
	resized, _, _, _ := storage.ProcessImage(bytes.NewReader(photo), 0, 400)
	for name, tc := range map[string]struct {
		tok, oid string
		img      []byte
	}{"same sighting": {ada, id(o1), photo}, "own other sighting": {ada, id(o2), resized}, "someone else": {bo, id(o3), photo}} {
		if code, res := upload(tc.tok, tc.oid, tc.img); code != 409 || res["code"] != "duplicate_photo" {
			t.Errorf("%s: %d %v", name, code, res)
		}
	}
	if code, _ := upload(ada, id(o2), testJPEG(t, 800, 600, false)); code != 201 {
		t.Errorf("a different photo: %d", code)
	}

	// Sightings: the same bird, place and minute is a duplicate; a retry of the same upload is not.
	_, sp := call("GET", "/species?q=pied+crow&limit=1", "", "")
	crow := id(sp["items"].([]any)[0].(map[string]any))
	_, first := sighting(ada, crow, 8.45, at)
	if code, res := sighting(ada, crow, 8.45001, at.Add(20*time.Second)); code != 409 || res["observation_id"].(float64) != first["id"].(float64) {
		t.Errorf("duplicate sighting: %d %v", code, res)
	}
	if code, _ := sighting(ada, crow, 8.46, at); code != 201 { // ~1 km away: another flock
		t.Errorf("same bird elsewhere: %d", code)
	}
	retry := `{"client_id":"dup-1","species_id":` + crow + `,"observed_at":"` + at.Add(-3*time.Hour).Format(time.RFC3339) + `","lat":8.5,"lng":-13.2}`
	c1, a := call("POST", "/observations", ada, retry)
	c2, b := call("POST", "/observations", ada, retry)
	if c1 != 201 || c2 != 200 || a["id"] != b["id"] {
		t.Errorf("offline retry: %d %d", c1, c2)
	}

	// A burst: 60 sightings in the same few minutes is too many.
	burstAt := at.Add(-10 * time.Hour)
	code := 0
	for i := range 61 {
		code, _ = sighting(bo, "", 7+float64(i)*0.01, burstAt)
	}
	if code != 400 {
		t.Errorf("61st sighting in the same minutes: %d", code)
	}
}
