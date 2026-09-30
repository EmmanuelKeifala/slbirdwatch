package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/slbirdwatch/backend/internal/storage"
)

// LIB-12b: seed one reference recording per species from Xeno-canto (API v3, key in XENO_API_KEY).
// Only quality-A (else B) recordings of 5–60 s are used, stored whole: we convert the format (allowed by CC 4.0
// as a technical modification) but never trim, because many recordings are CC BY-NC-ND.

type xenoClient struct {
	http *http.Client
	key  string
	base string // overridable in tests
	ua   string
	gap  time.Duration // pause between API calls
}

func newXenoClient() (*xenoClient, error) {
	key := os.Getenv("XENO_API_KEY")
	if key == "" {
		return nil, errors.New("set XENO_API_KEY (see backend/.env)")
	}
	return &xenoClient{http: &http.Client{Timeout: 60 * time.Second}, key: key, base: "https://xeno-canto.org",
		ua: "SLBirdwatch/0.1 seed-sounds", gap: time.Second}, nil
}

type xenoRecording struct {
	ID     string `json:"id"`
	Rec    string `json:"rec"`
	Lic    string `json:"lic"`
	Q      string `json:"q"`
	Length string `json:"length"`
	Type   string `json:"type"`
	File   string `json:"file"`
	URL    string `json:"url"`
}

// best returns the top recording for a species: quality A (else B), 5–60 s, songs before calls.
func (xc *xenoClient) best(ctx context.Context, genus, species string) (*xenoRecording, error) {
	rec, err := xc.bestOfQuality(ctx, genus, species, "A")
	if err != nil || rec != nil {
		return rec, err
	}
	time.Sleep(xc.gap)
	return xc.bestOfQuality(ctx, genus, species, "B")
}

func (xc *xenoClient) bestOfQuality(ctx context.Context, genus, species, quality string) (*xenoRecording, error) {
	q := url.Values{
		"query":    {fmt.Sprintf("gen:%s sp:%s q:%s len:5-60", strings.ToLower(genus), strings.ToLower(species), quality)},
		"per_page": {"50"},
		"key":      {xc.key},
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", xc.base+"/api/3/recordings?"+q.Encode(), nil)
	req.Header.Set("User-Agent", xc.ua)
	resp, err := xc.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var body struct {
		Message    string          `json:"message"`
		Recordings []xenoRecording `json:"recordings"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("xeno-canto: %s", resp.Status)
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("xeno-canto: %s %s", resp.Status, body.Message)
	}
	var pick *xenoRecording
	for i := range body.Recordings {
		r := &body.Recordings[i]
		if r.File == "" || licenceName(r.Lic) == "" {
			continue
		}
		if pick == nil || (strings.Contains(r.Type, "song") && !strings.Contains(pick.Type, "song")) {
			pick = r
		}
	}
	return pick, nil
}

// licenceName turns a Creative Commons URL into a short label ("" if it isn't a CC licence).
func licenceName(u string) string {
	u = strings.ToLower(u)
	if strings.Contains(u, "publicdomain/zero") {
		return "CC0"
	}
	_, rest, ok := strings.Cut(u, "creativecommons.org/licenses/")
	if !ok {
		return ""
	}
	parts := strings.Split(strings.Trim(rest, "/"), "/")
	if len(parts) < 2 || parts[0] == "" {
		return ""
	}
	return "CC " + strings.ToUpper(parts[0]) + " " + parts[1]
}

func (xc *xenoClient) download(ctx context.Context, fileURL, dest string) error {
	req, _ := http.NewRequestWithContext(ctx, "GET", fileURL, nil)
	req.Header.Set("User-Agent", xc.ua)
	resp, err := xc.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("download: %s", resp.Status)
	}
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, io.LimitReader(resp.Body, maxAudioBytes))
	return err
}

// seedSounds fetches recordings for up to `limit` extant species not yet looked up. Resumable.
func (a *Server) seedSounds(ctx context.Context, xc *xenoClient, limit int) (found, missing, failed int, err error) {
	for n := range limit {
		var id int64
		var sci, genus string
		err := a.db.QueryRow(ctx, `
			SELECT s.id, s.scientific_name, s.genus FROM species s
			LEFT JOIN species_sounds ss ON ss.species_id = s.id
			WHERE ss.species_id IS NULL AND NOT s.extinct
			ORDER BY EXISTS (SELECT 1 FROM region_species r WHERE r.species_id = s.id) DESC, s.seq -- Sierra Leone birds first
			LIMIT 1 OFFSET $1`, failed).Scan(&id, &sci, &genus)
		if errors.Is(err, pgx.ErrNoRows) {
			return found, missing, failed, nil
		}
		if err != nil {
			return found, missing, failed, err
		}
		epithet := strings.TrimSpace(strings.TrimPrefix(sci, genus))
		rec, err := xc.best(ctx, genus, epithet)
		if err == nil && rec == nil {
			_, err = a.db.Exec(ctx, `INSERT INTO species_sounds (species_id, status) VALUES ($1, 'missing') ON CONFLICT DO NOTHING`, id)
			missing++
		} else if err == nil {
			err = a.storeSpeciesSound(ctx, xc, id, rec)
			if err == nil {
				found++
			}
		}
		if err != nil {
			log.Printf("species %d (%s): %v (will retry on next run)", id, sci, err)
			failed++ // skipped this run via OFFSET; retried next run
		}
		if (n+1)%25 == 0 {
			log.Printf("seed-sounds: %d looked up, %d with sounds, %d without, %d to retry", n+1, found, missing, failed)
		}
		select {
		case <-time.After(xc.gap):
		case <-ctx.Done():
			return found, missing, failed, ctx.Err()
		}
	}
	return found, missing, failed, nil
}

func (a *Server) storeSpeciesSound(ctx context.Context, xc *xenoClient, id int64, rec *xenoRecording) error {
	dir, err := os.MkdirTemp("", "xc-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	in, m4a, png := filepath.Join(dir, "in"), filepath.Join(dir, "out.m4a"), filepath.Join(dir, "spec.png")
	if err := xc.download(ctx, rec.File, in); err != nil {
		return err
	}
	dur, err := probeSeconds(ctx, in)
	if err != nil {
		return err
	}
	if dur > maxClipSeconds+1 {
		return fmt.Errorf("recording is %.0f s, longer than listed", dur)
	}
	if err := clip(ctx, in, m4a, 0, dur); err != nil { // whole recording: format conversion only
		return err
	}
	if err := spectrogram(ctx, m4a, png); err != nil {
		return err
	}
	audio, err1 := os.ReadFile(m4a)
	image, err2 := os.ReadFile(png)
	if err := errors.Join(err1, err2); err != nil {
		return err
	}
	prefix := "species/" + strconv.FormatInt(id, 10) + "/"
	key, specKey := storage.NewKey(prefix+"sound-", ".m4a"), storage.NewKey(prefix+"spec-", ".png")
	if err := a.media.Put(ctx, key, "audio/mp4", audio); err != nil {
		return err
	}
	if err := a.media.Put(ctx, specKey, "image/png", image); err != nil {
		a.media.Remove(ctx, key)
		return err
	}
	_, err = a.db.Exec(ctx, `
		INSERT INTO species_sounds (species_id, status, key, spec_key, duration_ms, call_type, credit, licence, licence_url, source_url)
		VALUES ($1, 'ok', $2, $3, $4, $5, $6, $7, $8, $9)`,
		id, key, specKey, int(dur*1000), rec.Type, plainText(rec.Rec), licenceName(rec.Lic), rec.Lic, rec.URL)
	if err != nil {
		a.media.Remove(ctx, key)
		a.media.Remove(ctx, specKey)
	}
	return err
}
