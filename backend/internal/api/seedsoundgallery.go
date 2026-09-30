package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/slbirdwatch/backend/internal/storage"
)

// LIB-09: go run ./cmd/birdwatch seed-sound-gallery [limit] — for each Sierra Leone species, up to 2 Xeno-canto recordings
// of each kind (song, call, alarm, flight call), preferring Sierra Leone, then West Africa, then quality,
// and one from each season where it can. Resumable; a failed recording is skipped.

const perKind = 2

var westAfrica = []string{"Sierra Leone", "Guinea", "Liberia", "Côte d'Ivoire", "Ivory Coast", "Ghana", "Senegal", "Gambia",
	"Guinea-Bissau", "Mali", "Burkina Faso", "Togo", "Benin", "Nigeria", "Niger", "Mauritania", "Cape Verde"}

// soundKind sorts Xeno-canto's free-text type into our four kinds ("" = skip, e.g. drumming, wing noise).
func soundKind(t string) string {
	t = strings.ToLower(t)
	switch {
	case strings.Contains(t, "alarm"):
		return "alarm"
	case strings.Contains(t, "flight call"):
		return "flight"
	case strings.Contains(t, "song"):
		return "song"
	case strings.Contains(t, "call"):
		return "call"
	}
	return ""
}

type xcRec struct {
	xenoRecording
	Cnt  string `json:"cnt"`
	Sex  string `json:"sex"`
	Date string `json:"date"`
}

func (r xcRec) month() int {
	if len(r.Date) >= 7 {
		if m, err := strconv.Atoi(r.Date[5:7]); err == nil && m >= 1 && m <= 12 {
			return m
		}
	}
	return 0
}

// rank: lower is better — Sierra Leone, then West Africa, then elsewhere; quality A..E within each.
func (r xcRec) rank() int {
	place := 2
	if r.Cnt == "Sierra Leone" {
		place = 0
	} else if slices.Contains(westAfrica, r.Cnt) {
		place = 1
	}
	q := strings.Index("ABCDE", r.Q)
	if q < 0 {
		q = 5
	}
	return place*10 + q
}

// pickSounds chooses up to perKind recordings per kind: the best-ranked, then, for the second,
// the best one from the other season (West African recordings) if there is one.
func pickSounds(recs []xcRec) []xcRec {
	byKind := map[string][]xcRec{}
	seen := map[string]bool{}
	for _, r := range recs {
		k := soundKind(r.Type)
		if k == "" || r.File == "" || licenceName(r.Lic) == "" || seen[r.ID] {
			continue
		}
		seen[r.ID] = true
		byKind[k] = append(byKind[k], r)
	}
	var out []xcRec
	for _, k := range []string{"song", "call", "alarm", "flight"} {
		list := byKind[k]
		slices.SortStableFunc(list, func(a, b xcRec) int { return a.rank() - b.rank() })
		if len(list) == 0 {
			continue
		}
		first := list[0]
		out = append(out, first)
		if perKind < 2 || len(list) < 2 {
			continue
		}
		second := list[1]
		for _, r := range list[1:] {
			if r.rank() < 20 && first.month() > 0 && r.month() > 0 && wetSeason(r.month()) != wetSeason(first.month()) {
				second = r
				break
			}
		}
		out = append(out, second)
	}
	return out
}

func (xc *xenoClient) search(ctx context.Context, query string) ([]xcRec, error) {
	q := url.Values{"query": {query}, "per_page": {"100"}, "key": {xc.key}}
	req, _ := http.NewRequestWithContext(ctx, "GET", xc.base+"/api/3/recordings?"+q.Encode(), nil)
	req.Header.Set("User-Agent", xc.ua)
	resp, err := xc.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var body struct {
		Message    string  `json:"message"`
		Recordings []xcRec `json:"recordings"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("xeno-canto: %s", resp.Status)
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("xeno-canto: %s %s", resp.Status, body.Message)
	}
	return body.Recordings, nil
}

func (a *Server) seedSoundGallery(ctx context.Context, xc *xenoClient, limit int) (species, sounds int, err error) {
	rows, err := a.db.Query(ctx, `
		SELECT s.id, s.scientific_name, s.genus FROM region_species r JOIN species s ON s.id = r.species_id
		WHERE NOT EXISTS (SELECT 1 FROM species_sound_gallery_runs g WHERE g.species_id = s.id)
		ORDER BY r.records DESC LIMIT $1`, limit)
	if err != nil {
		return 0, 0, err
	}
	type todo struct {
		id         int64
		sci, genus string
	}
	var list []todo
	for rows.Next() {
		var t todo
		rows.Scan(&t.id, &t.sci, &t.genus)
		list = append(list, t)
	}
	if err := rows.Err(); err != nil {
		return 0, 0, err
	}
	for _, t := range list {
		base := fmt.Sprintf("gen:%s sp:%s len:5-60", strings.ToLower(t.genus), strings.ToLower(strings.TrimSpace(strings.TrimPrefix(t.sci, t.genus))))
		var recs []xcRec
		for _, q := range []string{base + ` cnt:"sierra leone"`, base} {
			var r []xcRec
			var err error
			for try := 1; try <= 4; try++ { // Xeno-canto is slow at times
				if r, err = xc.search(ctx, q); err == nil {
					break
				}
				time.Sleep(time.Duration(try) * 10 * time.Second)
			}
			if err != nil {
				return species, sounds, err
			}
			recs = append(recs, r...)
			time.Sleep(xc.gap)
		}
		picked := pickSounds(recs)
		errs := make([]error, len(picked))
		var wg sync.WaitGroup
		sem := make(chan struct{}, 2) // two downloads at a time, to stay polite
		for i, r := range picked {
			wg.Add(1)
			sem <- struct{}{}
			go func() {
				defer func() { <-sem; wg.Done() }()
				errs[i] = a.storeGallerySound(ctx, xc, t.id, r)
			}()
		}
		wg.Wait()
		failed := false
		for i, err := range errs {
			if err != nil { // a slow or broken file is skipped, not fatal; the species is retried next run
				log.Printf("seed-sound-gallery: %s XC%s skipped: %v", t.sci, picked[i].ID, err)
				failed = true
				continue
			}
			sounds++
		}
		if failed {
			continue // not marked as done
		}
		if _, err := a.db.Exec(ctx, `INSERT INTO species_sound_gallery_runs (species_id) VALUES ($1)`, t.id); err != nil {
			return species, sounds, err
		}
		species++
		if species%25 == 0 {
			log.Printf("seed-sound-gallery: %d species, %d recordings", species, sounds)
		}
	}
	return species, sounds, nil
}

func (a *Server) storeGallerySound(ctx context.Context, xc *xenoClient, speciesID int64, r xcRec) error {
	var have bool // stored by an earlier, interrupted run
	a.db.QueryRow(ctx, `SELECT true FROM species_sound_gallery WHERE source_id = $1`, "xc:"+r.ID).Scan(&have)
	if have {
		return nil
	}
	dir, err := os.MkdirTemp("", "xc-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	in, m4a, png := filepath.Join(dir, "in"), filepath.Join(dir, "out.m4a"), filepath.Join(dir, "spec.png")
	if err := xc.download(ctx, r.File, in); err != nil {
		return err
	}
	dur, err := probeSeconds(ctx, in)
	if err != nil {
		return err
	}
	if dur > maxClipSeconds+1 {
		return fmt.Errorf("recording is %.0f s, longer than listed", dur)
	}
	if err := clip(ctx, in, m4a, 0, dur); err != nil { // whole recording: format conversion only (ND licences)
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
	prefix := "species/" + strconv.FormatInt(speciesID, 10) + "/"
	key, specKey := storage.NewKey(prefix+"sound-", ".m4a"), storage.NewKey(prefix+"spec-", ".png")
	if err := a.media.Put(ctx, key, "audio/mp4", audio); err != nil {
		return err
	}
	if err := a.media.Put(ctx, specKey, "image/png", image); err != nil {
		a.media.Remove(ctx, key)
		return err
	}
	var month any
	if m := r.month(); m > 0 {
		month = m
	}
	_, err = a.db.Exec(ctx, `
		INSERT INTO species_sound_gallery (species_id, key, spec_key, duration_ms, kind, call_type, sex, country, month,
		                                   credit, licence, licence_url, source_url, source_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) ON CONFLICT (source_id) DO NOTHING`,
		speciesID, key, specKey, int(dur*1000), soundKind(r.Type), r.Type, r.Sex, r.Cnt, month,
		plainText(r.Rec), licenceName(r.Lic), r.Lic, r.URL, "xc:"+r.ID)
	if err != nil {
		a.media.Remove(ctx, key)
		a.media.Remove(ctx, specKey)
	}
	return err
}
