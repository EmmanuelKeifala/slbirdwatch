package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// testAudio makes an 8 s AAC clip: a 3 kHz whistle over light noise.
func testAudio(t *testing.T) []byte {
	t.Helper()
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed")
	}
	out := filepath.Join(t.TempDir(), "bird.m4a")
	cmd := exec.Command("ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=3000:duration=8",
		"-metadata", "location=+08.4844-013.2344/", "-c:a", "aac", out)
	if b, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg: %v %s", err, b)
	}
	data, _ := os.ReadFile(out)
	return data
}

func TestSounds(t *testing.T) {
	audio := testAudio(t)
	call, email := apiTest(t)
	h := testRouter(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	token := out["token"].(string)
	_, out = call("POST", "/auth/signup", "", creds("other-"+email, "correct horse", "Bo"))
	other := out["token"].(string)
	t.Cleanup(func() { call("DELETE", "/me", other, `{"password":"correct horse"}`) })
	_, o := call("POST", "/observations", token, `{"observed_at":"`+time.Now().UTC().Format(time.RFC3339)+`","lat":8.48,"lng":-13.23}`)
	oid := strconv.Itoa(int(o["id"].(float64)))

	send := func(tok, path string, data []byte, fields map[string]string) (int, map[string]any) {
		var body bytes.Buffer
		mw := multipart.NewWriter(&body)
		for k, v := range fields {
			mw.WriteField(k, v)
		}
		fw, _ := mw.CreateFormFile("audio", "bird.m4a")
		fw.Write(data)
		mw.Close()
		req := httptest.NewRequest("POST", path, &body)
		req.Header.Set("Content-Type", mw.FormDataContentType())
		req.Header.Set("Authorization", "Bearer "+tok)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code, decode(rec.Body)
	}
	fetch := func(path string) (int, string, []byte) {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		return rec.Code, rec.Header().Get("Content-Type"), rec.Body.Bytes()
	}

	// Preview: duration + spectrogram, nothing stored.
	code, p := send(token, "/audio/preview", audio, nil)
	if code != 200 || p["duration_s"].(float64) < 7.9 || !strings.HasPrefix(p["spectrogram"].(string), "data:image/png;base64,") {
		t.Fatalf("preview: %d %v", code, p["duration_s"])
	}
	if code, _ := send(token, "/audio/preview", []byte("not audio"), nil); code != http.StatusBadRequest {
		t.Fatalf("garbage preview: %d", code)
	}

	if code, _ := send(other, "/observations/"+oid+"/sounds", audio, nil); code != http.StatusNotFound {
		t.Fatalf("other user upload: %d", code)
	}
	if code, _ := send(token, "/observations/"+oid+"/sounds", audio, map[string]string{"trim_start": "5", "trim_end": "5.2"}); code != http.StatusBadRequest {
		t.Fatalf("too-short trim: %d", code)
	}

	code, s := send(token, "/observations/"+oid+"/sounds", audio, map[string]string{"trim_start": "2", "trim_end": "5", "licence": "cc-by"})
	if code != http.StatusCreated || s["licence"] != "cc-by" {
		t.Fatalf("add sound: %d %v", code, s)
	}
	if d := s["duration_s"].(float64); d < 2.8 || d > 3.2 {
		t.Fatalf("trimmed duration %.2f, want ~3", d)
	}
	code, ct, clip := fetch(s["url"].(string))
	if code != 200 || ct != "audio/mp4" || bytes.Contains(clip, []byte("08.4844")) {
		t.Fatalf("stored clip: %d %s location-metadata=%v", code, ct, bytes.Contains(clip, []byte("08.4844")))
	}
	if code, ct, _ := fetch(s["spectrogram_url"].(string)); code != 200 || ct != "image/png" {
		t.Fatalf("spectrogram: %d %s", code, ct)
	}

	_, got := call("GET", "/observations/"+oid, token, "")
	if ss := got["sounds"].([]any); len(ss) != 1 || len(got["photos"].([]any)) != 0 {
		t.Fatalf("observation media: sounds=%v photos=%v", ss, got["photos"])
	}

	// LIB-09: the observer tags the recording; it comes back on the sighting.
	sndID := strconv.Itoa(int(s["id"].(float64)))
	if code, v := call("PUT", "/photos/tags", token, `{"media_ref":"sound:`+sndID+`","tags":["flight","song"]}`); code != 200 || fmt.Sprint(v["tags"]) != "[song flight]" {
		t.Fatalf("tag sound: %d %v", code, v)
	}
	if _, got := call("GET", "/observations/"+oid, token, ""); fmt.Sprint(got["sounds"].([]any)[0].(map[string]any)["tags"]) != "[song flight]" {
		t.Errorf("sound tags on the sighting: %v", got["sounds"])
	}

	// QZ-02: once the sighting is verified, its sound feeds the sound quiz.
	db := testDB(t)
	db.Exec(t.Context(), `UPDATE observations SET status = 'verified', community_species_id = (SELECT id FROM species WHERE scientific_name = 'Corvus albus') WHERE id = $1`, oid)
	// Each quiz picks one recording per species at random (Xeno-canto clips compete), so try a few rounds.
	rec := httptest.NewRecorder()
	var quiz struct{ Questions []quizQuestion }
	var inQuiz bool
	for try := 0; try < 40 && !inQuiz; try++ {
		rec = httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", "/quiz/sound?n=20&family=Corvidae", nil))
		json.NewDecoder(rec.Body).Decode(&quiz)
		for _, q := range quiz.Questions {
			inQuiz = inQuiz || (q.Sound != nil && q.Sound.URL == s["url"] && q.Image == nil && len(q.Options) == 4)
		}
	}
	if !inQuiz {
		t.Fatalf("verified sound missing from sound quiz: %d %+v", rec.Code, quiz.Questions)
	}

	sid := strconv.Itoa(int(s["id"].(float64)))
	if code, _ := call("DELETE", "/observations/"+oid+"/sounds/"+sid, token, ""); code != http.StatusNoContent {
		t.Fatalf("delete sound: %d", code)
	}
	if code, _, _ := fetch(s["url"].(string)); code != http.StatusNotFound {
		t.Fatalf("deleted clip still served: %d", code)
	}
}
