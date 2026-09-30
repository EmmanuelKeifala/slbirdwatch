package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/slbirdwatch/backend/internal/storage"
)

// LIB-08: go run ./cmd/birdwatch seed-gallery [limit] — up to 8 photos per Sierra Leone species from research-grade
// iNaturalist observations: 2 male, 2 female, 2 juvenile (from observers' annotations), then the most-voted
// photos, alternating rainy and dry season so seasonal plumage shows. CC licences without ND only. Resumable.

const galleryMax = 8

// iNaturalist photo licence codes we can re-encode and show, with their deeds.
var inatLicences = map[string]struct{ name, url string }{
	"cc0":         {"CC0", "https://creativecommons.org/publicdomain/zero/1.0/"},
	"cc-by":       {"CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/"},
	"cc-by-sa":    {"CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"},
	"cc-by-nc":    {"CC BY-NC 4.0", "https://creativecommons.org/licenses/by-nc/4.0/"},
	"cc-by-nc-sa": {"CC BY-NC-SA 4.0", "https://creativecommons.org/licenses/by-nc-sa/4.0/"},
}

type inatClient struct {
	http *http.Client
	base string // overridable in tests
	gap  time.Duration
}

func newINatClient() *inatClient {
	return &inatClient{http: &http.Client{Timeout: 60 * time.Second}, base: "https://api.inaturalist.org", gap: time.Second}
}

func (ic *inatClient) get(ctx context.Context, path string, q url.Values, out any) error {
	for try := 1; ; try++ {
		err := func() error {
			req, _ := http.NewRequestWithContext(ctx, "GET", ic.base+path+"?"+q.Encode(), nil)
			req.Header.Set("User-Agent", "SLBirdwatch/0.1 seed-gallery")
			resp, err := ic.http.Do(req)
			if err != nil {
				return err
			}
			defer resp.Body.Close()
			if resp.StatusCode != 200 {
				return fmt.Errorf("inaturalist %s: %s", path, resp.Status)
			}
			return json.NewDecoder(resp.Body).Decode(out)
		}()
		time.Sleep(ic.gap) // iNaturalist asks for about one request a second
		if err == nil || try == 4 {
			return err
		}
		time.Sleep(time.Duration(try) * 5 * ic.gap)
	}
}

// taxon finds iNaturalist's bird species for a scientific name (its own name or a synonym), 0 if none.
func (ic *inatClient) taxon(ctx context.Context, name string) (int64, error) {
	var r struct {
		Results []struct {
			ID          int64  `json:"id"`
			MatchedTerm string `json:"matched_term"`
			Iconic      string `json:"iconic_taxon_name"`
		} `json:"results"`
	}
	if err := ic.get(ctx, "/v1/taxa", url.Values{"q": {name}, "rank": {"species"}, "per_page": {"5"}}, &r); err != nil {
		return 0, err
	}
	for _, t := range r.Results {
		if t.Iconic == "Aves" && strings.EqualFold(t.MatchedTerm, name) {
			return t.ID, nil
		}
	}
	return 0, nil
}

type inatPhoto struct {
	id                           int64
	url, credit, licence, source string
	variant                      string
	month                        int
}

type inatObservation struct {
	URI  string `json:"uri"`
	User struct {
		Login string `json:"login"`
		Name  string `json:"name"`
	} `json:"user"`
	ObservedOn string `json:"observed_on"`
	Photos     []struct {
		ID          int64  `json:"id"`
		URL         string `json:"url"`
		LicenseCode string `json:"license_code"`
		Attribution string `json:"attribution"`
	} `json:"photos"`
	Annotations []struct {
		Attr  int `json:"controlled_attribute_id"`
		Value int `json:"controlled_value_id"`
	} `json:"annotations"`
}

// variantOf reads iNaturalist annotations: Sex (9) female 10 / male 11, Life Stage (1) adult 2 / juvenile 8.
func variantOf(o inatObservation) string {
	v := ""
	for _, a := range o.Annotations {
		switch {
		case a.Attr == 9 && a.Value == 11:
			return "male"
		case a.Attr == 9 && a.Value == 10:
			return "female"
		case a.Attr == 1 && a.Value == 8:
			v = "juvenile"
		case a.Attr == 1 && a.Value == 2 && v == "":
			v = "adult"
		}
	}
	return v
}

// photos returns the first usable photo of each observation matching the filters.
func (ic *inatClient) photos(ctx context.Context, taxon int64, extra url.Values, n int) ([]inatPhoto, error) {
	q := url.Values{"taxon_id": {strconv.FormatInt(taxon, 10)}, "quality_grade": {"research"}, "photos": {"true"},
		"photo_license": {"cc0,cc-by,cc-by-sa,cc-by-nc,cc-by-nc-sa"}, "order_by": {"votes"}, "per_page": {strconv.Itoa(n)}}
	for k, v := range extra {
		q[k] = v
	}
	var r struct {
		Results []inatObservation `json:"results"`
	}
	if err := ic.get(ctx, "/v1/observations", q, &r); err != nil {
		return nil, err
	}
	var out []inatPhoto
	for _, o := range r.Results {
		for _, p := range o.Photos {
			if _, ok := inatLicences[p.LicenseCode]; !ok || !strings.Contains(p.URL, "/square.") {
				continue
			}
			month := 0
			if t, err := time.Parse("2006-01-02", o.ObservedOn); err == nil {
				month = int(t.Month())
			}
			out = append(out, inatPhoto{id: p.ID, url: strings.Replace(p.URL, "/square.", "/large.", 1),
				credit: photoCredit(p.Attribution, o.User.Name, o.User.Login), licence: p.LicenseCode, source: o.URI, variant: variantOf(o), month: month})
			break
		}
	}
	return out, nil
}

// photoCredit turns "(c) Jane Doe, some rights reserved (CC BY-NC)" into "Jane Doe"; CC0 photos
// ("no rights reserved") fall back to the observer's name.
func photoCredit(attribution, name, login string) string {
	if a, ok := strings.CutPrefix(attribution, "(c) "); ok {
		if i := strings.LastIndex(a, ", "); i > 0 {
			return a[:i]
		}
	}
	if name != "" {
		return name
	}
	return login
}

// wetSeason: Sierra Leone's rains run May–October.
func wetSeason(month int) bool { return month >= 5 && month <= 10 }

// pickGallery keeps up to 2 photos per sex/juvenile, then fills to galleryMax from the general list,
// alternating rainy and dry season where it can. No photo twice.
func pickGallery(male, female, juvenile, general []inatPhoto) []inatPhoto {
	seen := map[int64]bool{}
	var out []inatPhoto
	add := func(p inatPhoto, variant string) {
		if !seen[p.id] && len(out) < galleryMax {
			seen[p.id] = true
			if variant != "" {
				p.variant = variant
			}
			out = append(out, p)
		}
	}
	for _, g := range []struct {
		list    []inatPhoto
		variant string
	}{{male, "male"}, {female, "female"}, {juvenile, "juvenile"}} {
		for _, p := range g.list[:min(2, len(g.list))] {
			add(p, g.variant)
		}
	}
	var wet, dry []inatPhoto
	for _, p := range general {
		if wetSeason(p.month) {
			wet = append(wet, p)
		} else {
			dry = append(dry, p)
		}
	}
	for i := 0; i < max(len(wet), len(dry)); i++ {
		if i < len(dry) {
			add(dry[i], "")
		}
		if i < len(wet) {
			add(wet[i], "")
		}
	}
	return out
}

func (a *Server) seedGallery(ctx context.Context, ic *inatClient, wc *wikiClient, limit int) (species, photos int, err error) {
	rows, err := a.db.Query(ctx, `
		SELECT s.id, s.scientific_name FROM region_species r JOIN species s ON s.id = r.species_id
		WHERE NOT EXISTS (SELECT 1 FROM species_gallery_runs g WHERE g.species_id = s.id)
		ORDER BY r.records DESC LIMIT $1`, limit)
	if err != nil {
		return 0, 0, err
	}
	type todo struct {
		id   int64
		name string
	}
	var list []todo
	for rows.Next() {
		var t todo
		rows.Scan(&t.id, &t.name)
		list = append(list, t)
	}
	if err := rows.Err(); err != nil {
		return 0, 0, err
	}
	for _, t := range list {
		taxon, err := ic.taxon(ctx, t.name)
		if err != nil {
			return species, photos, err
		}
		if taxon != 0 {
			var lists [4][]inatPhoto
			for i, extra := range []url.Values{
				{"term_id": {"9"}, "term_value_id": {"11"}},
				{"term_id": {"9"}, "term_value_id": {"10"}},
				{"term_id": {"1"}, "term_value_id": {"8"}},
				{},
			} {
				if lists[i], err = ic.photos(ctx, taxon, extra, map[bool]int{true: 30, false: 4}[i == 3]); err != nil {
					return species, photos, err
				}
			}
			picked := pickGallery(lists[0], lists[1], lists[2], lists[3])
			errs := make([]error, len(picked))
			var wg sync.WaitGroup
			sem := make(chan struct{}, 4) // downloads come from iNaturalist's open-data bucket, not the API
			for i, p := range picked {
				wg.Add(1)
				sem <- struct{}{}
				go func() {
					defer func() { <-sem; wg.Done() }()
					errs[i] = a.storeGalleryPhoto(ctx, wc, t.id, p)
				}()
			}
			wg.Wait()
			failed := false
			for i, err := range errs {
				if err != nil { // one slow or broken image shouldn't stop the run; the species is retried next run
					log.Printf("seed-gallery: %s photo %d skipped: %v", t.name, picked[i].id, err)
					failed = true
					continue
				}
				photos++
			}
			if failed {
				continue // not marked as done
			}
		}
		var tx any
		if taxon != 0 {
			tx = taxon
		}
		if _, err := a.db.Exec(ctx, `INSERT INTO species_gallery_runs (species_id, inat_taxon) VALUES ($1, $2)`, t.id, tx); err != nil {
			return species, photos, err
		}
		species++
	}
	return species, photos, nil
}

func (a *Server) storeGalleryPhoto(ctx context.Context, wc *wikiClient, speciesID int64, p inatPhoto) error {
	var have bool // stored by an earlier, interrupted run
	a.db.QueryRow(ctx, `SELECT true FROM species_gallery WHERE source_id = $1`, "inat-photo:"+strconv.FormatInt(p.id, 10)).Scan(&have)
	if have {
		return nil
	}
	raw, err := wc.download(ctx, p.url) // plain HTTP GET with 429 retries
	if err != nil {
		return err
	}
	full, thumb, w, h, err := storage.ProcessImageWithThumb(bytes.NewReader(raw), 1024, 400)
	if err != nil {
		return err
	}
	prefix := "species/" + strconv.FormatInt(speciesID, 10) + "/gallery-"
	key, thumbKey := storage.NewKey(prefix, ".jpg"), storage.NewKey(prefix+"thumb-", ".jpg")
	if err := a.media.PutJPEG(ctx, key, full); err != nil {
		return err
	}
	if err := a.media.PutJPEG(ctx, thumbKey, thumb); err != nil {
		a.media.Remove(ctx, key)
		return err
	}
	var month any
	if p.month > 0 {
		month = p.month
	}
	lic := inatLicences[p.licence]
	_, err = a.db.Exec(ctx, `
		INSERT INTO species_gallery (species_id, key, thumb_key, width, height, variant, month, credit, licence, licence_url, source_url, source_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (source_id) DO NOTHING`,
		speciesID, key, thumbKey, w, h, p.variant, month, p.credit, lic.name, lic.url, p.source, "inat-photo:"+strconv.FormatInt(p.id, 10))
	if err != nil {
		a.media.Remove(ctx, key)
		a.media.Remove(ctx, thumbKey)
	}
	return err
}
