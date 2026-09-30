package api

import (
	"bytes"
	"image/jpeg"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"
)

func TestObservationPhotos(t *testing.T) {
	call, email := apiTest(t)
	h := testRouter(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	token := out["token"].(string)
	_, out = call("POST", "/auth/signup", "", creds("other-"+email, "correct horse", "Bo"))
	other := out["token"].(string)
	t.Cleanup(func() { call("DELETE", "/me", other, `{"password":"correct horse"}`) })

	_, o := call("POST", "/observations", token, `{"observed_at":"`+time.Now().UTC().Format(time.RFC3339)+`","lat":8.48,"lng":-13.23}`)
	if ps, ok := o["photos"].([]any); !ok || len(ps) != 0 {
		t.Fatalf("new observation photos: %v", o["photos"])
	}
	oid := strconv.Itoa(int(o["id"].(float64)))

	licence := "" // form field sent with each upload; "" = profile default
	upload := func(tok, path string, img []byte) (int, map[string]any) {
		var body bytes.Buffer
		mw := multipart.NewWriter(&body)
		if licence != "" {
			mw.WriteField("licence", licence)
		}
		fw, _ := mw.CreateFormFile("image", "bird.jpg")
		fw.Write(img)
		mw.Close()
		req := httptest.NewRequest("POST", path, &body)
		req.Header.Set("Content-Type", mw.FormDataContentType())
		req.Header.Set("Authorization", "Bearer "+tok)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code, decode(rec.Body)
	}
	fetch := func(path string) (int, []byte) {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		b, _ := io.ReadAll(rec.Body)
		return rec.Code, b
	}

	img := testJPEG(t, 3000, 2000, true)
	if code, _ := upload(other, "/observations/"+oid+"/photos", img); code != http.StatusNotFound {
		t.Fatalf("other user upload: %d", code)
	}
	if code, _ := upload(token, "/observations/"+oid+"/photos", []byte("nope")); code != http.StatusBadRequest {
		t.Fatalf("garbage upload: %d", code)
	}
	code, p := upload(token, "/observations/"+oid+"/photos", img)
	if code != http.StatusCreated || p["width"].(float64) != 2048 || p["height"].(float64) != 1365 || p["licence"] != "cc-by-nc" {
		t.Fatalf("upload: %d %v", code, p)
	}
	code, full := fetch(p["url"].(string))
	if code != 200 || bytes.Contains(full, []byte("GPSLatitude")) {
		t.Fatalf("full image: %d gps=%v", code, bytes.Contains(full, []byte("GPSLatitude")))
	}
	code, thumb := fetch(p["thumb_url"].(string))
	cfg, _ := jpeg.DecodeConfig(bytes.NewReader(thumb))
	if code != 200 || cfg.Width != 480 {
		t.Fatalf("thumb: %d width %d", code, cfg.Width)
	}

	_, got := call("GET", "/observations/"+oid, token, "")
	if ps := got["photos"].([]any); len(ps) != 1 {
		t.Fatalf("observation photos: %v", ps)
	}
	_, mine := call("GET", "/me/observations", token, "")
	if ps := mine["items"].([]any)[0].(map[string]any)["photos"].([]any); len(ps) != 1 {
		t.Fatalf("list photos: %v", ps)
	}

	// OBS-12 licences: explicit per upload, else the profile default.
	small := func() []byte { return testJPEG(t, 64, 64, false) } // a new photo each time (duplicates are refused)
	licence = "public"
	if code, _ := upload(token, "/observations/"+oid+"/photos", small()); code != http.StatusBadRequest {
		t.Fatalf("bad licence: %d", code)
	}
	licence = "cc0"
	if _, p := upload(token, "/observations/"+oid+"/photos", small()); p["licence"] != "cc0" {
		t.Fatalf("explicit licence: %v", p)
	}
	licence = ""
	if code, u := call("PATCH", "/me", token, `{"default_licence":"cc-by"}`); code != 200 || u["default_licence"] != "cc-by" {
		t.Fatalf("set default licence: %d %v", code, u)
	}
	if code, _ := call("PATCH", "/me", token, `{"default_licence":"mine"}`); code != http.StatusBadRequest {
		t.Fatalf("bad default licence: %d", code)
	}
	if _, p := upload(token, "/observations/"+oid+"/photos", small()); p["licence"] != "cc-by" {
		t.Fatalf("default licence not applied: %v", p)
	}

	// Cap at 10 photos (3 uploaded so far).
	for i := 0; i < 7; i++ {
		if code, _ := upload(token, "/observations/"+oid+"/photos", small()); code != http.StatusCreated {
			t.Fatalf("photo %d: %d", i+2, code)
		}
	}
	if code, _ := upload(token, "/observations/"+oid+"/photos", small()); code != http.StatusBadRequest {
		t.Fatalf("11th photo: %d", code)
	}

	pid := strconv.Itoa(int(p["id"].(float64)))
	if code, _ := call("DELETE", "/observations/"+oid+"/photos/"+pid, other, ""); code != http.StatusNotFound {
		t.Fatalf("other user delete: %d", code)
	}
	if code, _ := call("DELETE", "/observations/"+oid+"/photos/"+pid, token, ""); code != http.StatusNoContent {
		t.Fatalf("delete: %d", code)
	}
	if code, _ := fetch(p["url"].(string)); code != http.StatusNotFound {
		t.Fatalf("deleted photo still served: %d", code)
	}

	// Account deletion removes the remaining objects too.
	_, got = call("GET", "/observations/"+oid, token, "")
	remaining := got["photos"].([]any)[0].(map[string]any)["url"].(string)
	call("DELETE", "/me", token, `{"password":"correct horse"}`)
	if code, _ := fetch(remaining); code != http.StatusNotFound {
		t.Fatalf("photo survived account deletion: %d", code)
	}
}
