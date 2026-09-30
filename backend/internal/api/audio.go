package api

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/slbirdwatch/backend/internal/storage"
)

// OBS-03 bird sounds. Needs ffmpeg + ffprobe on PATH (installed in the server image).
const (
	maxAudioBytes           = 20 << 20
	maxRawSeconds           = 10 * 60 // uploads longer than this are refused before any processing
	maxClipSeconds          = 60      // stored clips are trimmed to at most this
	maxSoundsPerObservation = 5
)

// saveUpload writes the multipart "audio" field to a temp dir, returning its path and a cleanup func.
func saveUpload(w http.ResponseWriter, r *http.Request) (string, func(), error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxAudioBytes+1<<20)
	f, _, err := r.FormFile("audio")
	if err != nil {
		return "", nil, errors.New(`send the recording as multipart field "audio"`)
	}
	defer f.Close()
	dir, err := os.MkdirTemp("", "sound-*")
	if err != nil {
		return "", nil, err
	}
	cleanup := func() { os.RemoveAll(dir) }
	path := filepath.Join(dir, "in")
	out, err := os.Create(path)
	if err == nil {
		_, err = io.Copy(out, f)
		out.Close()
	}
	if err != nil {
		cleanup()
		return "", nil, err
	}
	return path, cleanup, nil
}

func run(ctx context.Context, name string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, name, args...).Output()
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			return nil, fmt.Errorf("%s: %s", name, strings.TrimSpace(string(ee.Stderr)))
		}
		return nil, err
	}
	return out, nil
}

var errNotAudio = errors.New("that file isn't a recording we can read")

// probeSeconds returns an audio file's duration.
func probeSeconds(ctx context.Context, path string) (float64, error) {
	out, err := run(ctx, "ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "format=duration", "-of", "csv=p=0", path)
	if err != nil {
		return 0, errNotAudio
	}
	d, err := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
	if err != nil || d <= 0 {
		return 0, errNotAudio
	}
	return d, nil
}

// spectrogram renders a PNG focused on birdsong frequencies (0–12 kHz).
func spectrogram(ctx context.Context, in, out string) error {
	_, err := run(ctx, "ffmpeg", "-v", "error", "-y", "-i", in,
		"-lavfi", "showspectrumpic=s=1000x240:legend=0:color=plasma:stop=12000:drange=80", "-frames:v", "1", out)
	return err
}

// clip trims [start, start+dur) and re-encodes to mono AAC, which also drops any metadata.
func clip(ctx context.Context, in, out string, start, dur float64) error {
	_, err := run(ctx, "ffmpeg", "-v", "error", "-y", "-ss", fmt.Sprintf("%.3f", start), "-t", fmt.Sprintf("%.3f", dur),
		"-i", in, "-vn", "-map_metadata", "-1", "-ac", "1", "-ar", "44100", "-c:a", "aac", "-b:a", "96k",
		"-movflags", "+faststart", "-f", "mp4", out)
	return err
}

// POST /audio/preview — duration + spectrogram of an unsaved recording, for the trim UI. Nothing is stored.
func (a *Server) previewAudio(w http.ResponseWriter, r *http.Request) {
	if a.rateLimited(r.Context(), "preview:"+strconv.FormatInt(userID(r), 10), 120, time.Hour) {
		writeError(w, http.StatusTooManyRequests, "too many previews, try again later")
		return
	}
	path, cleanup, err := saveUpload(w, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	defer cleanup()
	dur, err := probeSeconds(r.Context(), path)
	if err == nil && dur > maxRawSeconds {
		err = fmt.Errorf("recordings can be at most %d minutes", maxRawSeconds/60)
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	png := filepath.Join(filepath.Dir(path), "spec.png")
	if err := spectrogram(r.Context(), path, png); err != nil {
		internalError(w, "spectrogram", err)
		return
	}
	data, err := os.ReadFile(png)
	if err != nil {
		internalError(w, "spectrogram", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"duration_s":  dur,
		"max_clip_s":  maxClipSeconds,
		"spectrogram": "data:image/png;base64," + base64.StdEncoding.EncodeToString(data),
	})
}

type sound struct {
	ID             int64    `json:"id"`
	URL            string   `json:"url"`
	SpectrogramURL string   `json:"spectrogram_url"`
	DurationS      float64  `json:"duration_s"`
	Licence        string   `json:"licence"`
	Tags           []string `json:"tags"` // LIB-09: song, call, alarm, flight (call)
}

// POST /observations/{id}/sounds — multipart "audio" + optional trim_start, trim_end (seconds) and licence.
func (a *Server) addSound(w http.ResponseWriter, r *http.Request) {
	oid, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if ok, err := a.ownsObservation(r, oid); err != nil {
		internalError(w, "sound owner check", err)
		return
	} else if !ok {
		http.NotFound(w, r)
		return
	}
	if a.rateLimited(r.Context(), "sound:"+strconv.FormatInt(userID(r), 10), 60, time.Hour) {
		writeError(w, http.StatusTooManyRequests, "too many uploads, try again later")
		return
	}
	path, cleanup, err := saveUpload(w, r)
	bad := func(msg string) { writeError(w, http.StatusBadRequest, msg) }
	if err != nil {
		bad(err.Error())
		return
	}
	defer cleanup()

	licence := r.FormValue("licence")
	if licence != "" && !slices.Contains(licences, licence) {
		bad("licence must be cc0, cc-by, cc-by-nc or all-rights-reserved")
		return
	}
	dur, err := probeSeconds(r.Context(), path)
	if err != nil {
		bad(err.Error())
		return
	}
	if dur > maxRawSeconds {
		bad(fmt.Sprintf("recordings can be at most %d minutes", maxRawSeconds/60))
		return
	}
	start, end := 0.0, dur
	if v := r.FormValue("trim_start"); v != "" {
		start, err = strconv.ParseFloat(v, 64)
	}
	if v := r.FormValue("trim_end"); err == nil && v != "" {
		end, err = strconv.ParseFloat(v, 64)
	}
	end = min(end, dur)
	if err != nil || start < 0 || end-start < 0.5 {
		bad("trim must keep at least half a second of the recording")
		return
	}
	if end-start > maxClipSeconds {
		bad(fmt.Sprintf("trim the clip to %d seconds or less", maxClipSeconds))
		return
	}

	dir := filepath.Dir(path)
	m4a, png := filepath.Join(dir, "clip.m4a"), filepath.Join(dir, "clip.png")
	if err := clip(r.Context(), path, m4a, start, end-start); err != nil {
		internalError(w, "clip", err)
		return
	}
	if err := spectrogram(r.Context(), m4a, png); err != nil {
		internalError(w, "spectrogram", err)
		return
	}
	clipDur, err := probeSeconds(r.Context(), m4a)
	if err != nil {
		internalError(w, "probe clip", err)
		return
	}
	audio, err1 := os.ReadFile(m4a)
	image, err2 := os.ReadFile(png)
	if err := errors.Join(err1, err2); err != nil {
		internalError(w, "read clip", err)
		return
	}

	prefix := "observations/" + strconv.FormatInt(oid, 10) + "/"
	key, specKey := storage.NewKey(prefix+"sound-", ".m4a"), storage.NewKey(prefix+"spec-", ".png")
	if err := a.media.Put(r.Context(), key, "audio/mp4", audio); err != nil {
		internalError(w, "store sound", err)
		return
	}
	if err := a.media.Put(r.Context(), specKey, "image/png", image); err != nil {
		a.media.Remove(r.Context(), key)
		internalError(w, "store spectrogram", err)
		return
	}
	s := sound{URL: a.media.URL(key), SpectrogramURL: a.media.URL(specKey), DurationS: clipDur, Tags: []string{}}
	err = a.db.QueryRow(r.Context(), `
		INSERT INTO media (observation_id, kind, key, thumb_key, duration_ms, licence)
		SELECT $1, 'sound', $2, $3, $4,
		       coalesce(nullif($6, '')::media_licence, (SELECT default_licence FROM users WHERE id = $7))
		WHERE (SELECT count(*) FROM media WHERE observation_id = $1 AND kind = 'sound') < $5
		RETURNING id, licence`, oid, key, specKey, int(clipDur*1000), maxSoundsPerObservation, licence, userID(r)).
		Scan(&s.ID, &s.Licence)
	if err != nil {
		a.media.Remove(r.Context(), key)
		a.media.Remove(r.Context(), specKey)
		if errors.Is(err, pgx.ErrNoRows) {
			bad(fmt.Sprintf("an observation can have at most %d sounds", maxSoundsPerObservation))
			return
		}
		internalError(w, "save sound", err)
		return
	}
	writeJSON(w, http.StatusCreated, s)
}
