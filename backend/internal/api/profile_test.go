package api

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"math/rand/v2"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/slbirdwatch/backend/internal/storage"
)

func testJPEG(t *testing.T, w, h int, withGPS bool) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	// A random grey block pattern, so every call is a different photo (OBS-15 rejects re-used photos).
	for by := range 8 {
		for bx := range 8 {
			g := uint8(rand.IntN(256))
			for y := by * h / 8; y < (by+1)*h/8; y++ {
				for x := bx * w / 8; x < (bx+1)*w/8; x++ {
					img.Set(x, y, color.RGBA{g, g, g, 255})
				}
			}
		}
	}
	for x := range w {
		img.Set(x, h/2, color.RGBA{200, 30, 30, 255})
	}
	var buf bytes.Buffer
	jpeg.Encode(&buf, img, nil)
	out := buf.Bytes()
	if withGPS {
		// Splice an APP1 "Exif" segment carrying a GPS marker right after SOI.
		payload := append([]byte("Exif\x00\x00"), []byte("GPSLatitude=8.4657N")...)
		seg := []byte{0xFF, 0xE1, 0, 0}
		binary.BigEndian.PutUint16(seg[2:], uint16(len(payload)+2))
		out = append(append(append([]byte{}, out[:2]...), append(seg, payload...)...), out[2:]...)
	}
	return out
}

func TestProcessImage(t *testing.T) {
	src := testJPEG(t, 1200, 800, true)
	if !bytes.Contains(src, []byte("GPSLatitude")) {
		t.Fatal("fixture lacks GPS marker")
	}

	sq, _, _, err := storage.ProcessImage(bytes.NewReader(src), 512, 0)
	if err != nil {
		t.Fatal(err)
	}
	cfg, _ := jpeg.DecodeConfig(bytes.NewReader(sq))
	if cfg.Width != 512 || cfg.Height != 512 {
		t.Fatalf("square: %dx%d", cfg.Width, cfg.Height)
	}
	if bytes.Contains(sq, []byte("Exif")) || bytes.Contains(sq, []byte("GPSLatitude")) {
		t.Fatal("metadata survived re-encoding")
	}

	capped, _, _, _ := storage.ProcessImage(bytes.NewReader(src), 0, 600)
	cfg, _ = jpeg.DecodeConfig(bytes.NewReader(capped))
	if cfg.Width != 600 || cfg.Height != 400 {
		t.Fatalf("long-edge cap: %dx%d", cfg.Width, cfg.Height)
	}

	small, _, _, _ := storage.ProcessImage(bytes.NewReader(testJPEG(t, 100, 80, false)), 512, 0)
	cfg, _ = jpeg.DecodeConfig(bytes.NewReader(small))
	if cfg.Width != 80 || cfg.Height != 80 {
		t.Fatalf("small images must not upscale: %dx%d", cfg.Width, cfg.Height)
	}

	if _, _, _, err := storage.ProcessImage(strings.NewReader("not an image"), 512, 0); err != storage.ErrBadImage {
		t.Fatalf("garbage: %v", err)
	}

	// A tiny PNG whose header claims 20000x20000 must be rejected before decoding.
	var p bytes.Buffer
	png.Encode(&p, image.NewGray(image.Rect(0, 0, 1, 1)))
	bomb := p.Bytes()
	binary.BigEndian.PutUint32(bomb[16:], 20000)
	binary.BigEndian.PutUint32(bomb[20:], 20000)
	binary.BigEndian.PutUint32(bomb[29:], crc32.ChecksumIEEE(bomb[12:29]))
	if _, _, _, err := storage.ProcessImage(bytes.NewReader(bomb), 512, 0); err == nil || !strings.Contains(err.Error(), "too large") {
		t.Fatalf("bomb: %v", err)
	}
}

func TestProfileFlow(t *testing.T) {
	call, email := apiTest(t)
	h := testRouter(t)

	code, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	if code != http.StatusCreated {
		t.Fatalf("signup: %d %v", code, out)
	}
	token := out["token"].(string)
	id := int(out["user"].(map[string]any)["id"].(float64))

	for _, bad := range []string{`{"display_name":""}`, `{"experience_level":"wizard"}`, `{"bio":"` + strings.Repeat("a", 501) + `"}`} {
		if code, _ := call("PATCH", "/me", token, bad); code != http.StatusBadRequest {
			t.Fatalf("patch %s: %d", bad[:20], code)
		}
	}
	code, out = call("PATCH", "/me", token, `{"home_area":" Freetown ","experience_level":"intermediate","bio":"Sunbird fan"}`)
	if code != 200 || out["home_area"] != "Freetown" || out["experience_level"] != "intermediate" || out["display_name"] != "Ada" {
		t.Fatalf("patch: %d %v", code, out)
	}
	if _, out = call("PATCH", "/me", token, `{"experience_level":""}`); out["experience_level"] != "" || out["bio"] != "Sunbird fan" {
		t.Fatalf("clear level / keep bio: %v", out)
	}

	upload := func() (int, map[string]any) {
		var body bytes.Buffer
		mw := multipart.NewWriter(&body)
		fw, _ := mw.CreateFormFile("image", "me.jpg")
		fw.Write(testJPEG(t, 900, 600, true))
		mw.Close()
		req := httptest.NewRequest("PUT", "/me/avatar", &body)
		req.Header.Set("Content-Type", mw.FormDataContentType())
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code, decode(rec.Body)
	}
	get := func(path string) (int, string, []byte) {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		b, _ := io.ReadAll(rec.Body)
		return rec.Code, rec.Header().Get("Content-Type"), b
	}

	code, out = upload()
	first, _ := out["avatar_url"].(string)
	if code != 200 || !strings.HasPrefix(first, "/media/avatars/") {
		t.Fatalf("avatar upload: %d %v", code, out)
	}
	if code, ct, b := get(first); code != 200 || ct != "image/jpeg" || bytes.Contains(b, []byte("GPSLatitude")) {
		t.Fatalf("serve avatar: %d %s gps=%v", code, ct, bytes.Contains(b, []byte("GPSLatitude")))
	}

	_, out = upload()
	second := out["avatar_url"].(string)
	if code, _, _ := get(first); second == first || code != http.StatusNotFound {
		t.Fatalf("old avatar not replaced/removed: %d", code)
	}

	code, _, b := get("/users/" + strconv.Itoa(id))
	if code != 200 || bytes.Contains(b, []byte(email)) || !bytes.Contains(b, []byte("Freetown")) {
		t.Fatalf("public profile: %d %s", code, b)
	}
	if code, _, _ := get("/users/999999999"); code != http.StatusNotFound {
		t.Fatalf("missing profile: %d", code)
	}

	if code, _ := call("DELETE", "/me/avatar", token, ""); code != http.StatusNoContent {
		t.Fatalf("delete avatar: %d", code)
	}
	if code, _, _ := get(second); code != http.StatusNotFound {
		t.Fatalf("avatar object not removed: %d", code)
	}
	if _, out = call("GET", "/me", token, ""); out["avatar_url"] != nil {
		t.Fatalf("avatar_url after delete: %v", out["avatar_url"])
	}
}
