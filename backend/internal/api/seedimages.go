package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/slbirdwatch/backend/internal/config"
	"github.com/slbirdwatch/backend/internal/storage"
	"golang.org/x/sync/errgroup"
)

// LIB-12: seed species photos from Wikimedia. Per batch of 50 species:
//  1. en.wikipedia pageimages (pilicense=free) → the article's lead image file name
//  2. Commons imageinfo → an 800 px thumbnail URL, photographer and licence
//  3. download, re-encode, store in S3 with attribution
// Wikimedia asks API clients to send a descriptive User-Agent with contact details: set WIKIMEDIA_CONTACT.

type wikiClient struct {
	http *http.Client
	ua   string
	base string // overridable in tests
}

func newWikiClient() *wikiClient {
	contact := config.Env("WIKIMEDIA_CONTACT", "contact not configured")
	return &wikiClient{
		http: &http.Client{Timeout: 30 * time.Second},
		ua:   "SLBirdwatch/0.1 (" + contact + ") seed-images",
	}
}

func (wc *wikiClient) getJSON(ctx context.Context, u string, out any) error {
	body, err := wc.download(ctx, u) // retries 429s
	if err != nil {
		return fmt.Errorf("GET %s: %w", u, err)
	}
	return json.Unmarshal(body, out)
}

// pageImages maps each title to its free lead-image file name ("" when none), following redirects.
func (wc *wikiClient) pageImages(ctx context.Context, titles []string) (map[string]string, error) {
	q := url.Values{
		"action": {"query"}, "format": {"json"}, "formatversion": {"2"}, "redirects": {"1"},
		"prop": {"pageimages"}, "piprop": {"name"}, "pilicense": {"free"}, "titles": {strings.Join(titles, "|")},
	}
	var r struct {
		Query struct {
			Normalized []struct{ From, To string } `json:"normalized"`
			Redirects  []struct{ From, To string } `json:"redirects"`
			Pages      []struct {
				Title     string `json:"title"`
				PageImage string `json:"pageimage"`
			} `json:"pages"`
		} `json:"query"`
	}
	if err := wc.getJSON(ctx, wc.api("https://en.wikipedia.org")+"?"+q.Encode(), &r); err != nil {
		return nil, err
	}
	resolve := map[string]string{}
	for _, n := range r.Query.Normalized {
		resolve[n.From] = n.To
	}
	redirect := map[string]string{}
	for _, rd := range r.Query.Redirects {
		redirect[rd.From] = rd.To
	}
	image := map[string]string{}
	for _, p := range r.Query.Pages {
		image[p.Title] = p.PageImage
	}
	out := make(map[string]string, len(titles))
	for _, t := range titles {
		title := t
		if n, ok := resolve[title]; ok {
			title = n
		}
		if rd, ok := redirect[title]; ok {
			title = rd
		}
		out[t] = image[title]
	}
	return out, nil
}

type commonsFile struct {
	ThumbURL, SourceURL, Credit, Licence, LicenceURL string
}

var tagRE = regexp.MustCompile(`<[^>]*>`)

func plainText(s string) string {
	s = html.UnescapeString(tagRE.ReplaceAllString(s, ""))
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > 200 {
		s = string(r[:200]) + "…"
	}
	return s
}

// commonsInfo looks up files on Commons; files hosted only on en.wikipedia come back absent and are skipped.
func (wc *wikiClient) commonsInfo(ctx context.Context, files []string) (map[string]commonsFile, error) {
	titles := make([]string, len(files))
	for i, f := range files {
		titles[i] = "File:" + f
	}
	q := url.Values{
		"action": {"query"}, "format": {"json"}, "formatversion": {"2"}, "prop": {"imageinfo"},
		"iiprop": {"url|extmetadata"}, "iiurlwidth": {"800"}, "titles": {strings.Join(titles, "|")},
	}
	var r struct {
		Query struct {
			Normalized []struct{ From, To string } `json:"normalized"`
			Pages      []struct {
				Title     string `json:"title"`
				Missing   bool   `json:"missing"`
				ImageInfo []struct {
					ThumbURL       string                         `json:"thumburl"`
					DescriptionURL string                         `json:"descriptionurl"`
					ExtMetadata    map[string]struct{ Value any } `json:"extmetadata"`
				} `json:"imageinfo"`
			} `json:"pages"`
		} `json:"query"`
	}
	if err := wc.getJSON(ctx, wc.api("https://commons.wikimedia.org")+"?"+q.Encode(), &r); err != nil {
		return nil, err
	}
	norm := map[string]string{}
	for _, n := range r.Query.Normalized {
		norm[n.To] = n.From
	}
	meta := func(m map[string]struct{ Value any }, k string) string {
		if v, ok := m[k].Value.(string); ok {
			return v
		}
		return ""
	}
	out := map[string]commonsFile{}
	for _, p := range r.Query.Pages {
		if p.Missing || len(p.ImageInfo) == 0 || p.ImageInfo[0].ThumbURL == "" {
			continue
		}
		ii := p.ImageInfo[0]
		licence := meta(ii.ExtMetadata, "LicenseShortName")
		if licence == "" {
			continue // no machine-readable licence: don't use it
		}
		title := p.Title
		if from, ok := norm[title]; ok {
			title = from
		}
		out[strings.TrimPrefix(title, "File:")] = commonsFile{
			ThumbURL:   ii.ThumbURL,
			SourceURL:  ii.DescriptionURL,
			Credit:     plainText(meta(ii.ExtMetadata, "Artist")),
			Licence:    licence,
			LicenceURL: meta(ii.ExtMetadata, "LicenseUrl"),
		}
	}
	return out, nil
}

func (wc *wikiClient) api(host string) string {
	if wc.base != "" {
		return wc.base + "/w/api.php"
	}
	return host + "/w/api.php"
}

// download fetches an image, honouring 429 Retry-After up to 3 times.
func (wc *wikiClient) download(ctx context.Context, u string) ([]byte, error) {
	for attempt := 0; ; attempt++ {
		req, _ := http.NewRequestWithContext(ctx, "GET", u, nil)
		req.Header.Set("User-Agent", wc.ua)
		resp, err := wc.http.Do(req)
		if err != nil {
			return nil, err
		}
		if resp.StatusCode == http.StatusTooManyRequests && attempt < 3 {
			resp.Body.Close()
			wait, _ := strconv.Atoi(resp.Header.Get("Retry-After"))
			select {
			case <-time.After(time.Duration(max(wait, 5*(attempt+1))) * time.Second):
				continue
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("download: %s", resp.Status)
		}
		return io.ReadAll(io.LimitReader(resp.Body, storage.MaxUploadBytes))
	}
}

// seedImages fetches photos for up to `limit` extant species that haven't been looked up yet.
func (a *Server) seedImages(ctx context.Context, wc *wikiClient, limit int) (found, missing int, err error) {
	failed := 0
	retryLater := []int64{} // failed this run; excluded so the loop moves on (non-nil: a nil slice is SQL NULL)
	for done := 0; done < limit; {
		rows, err := a.db.Query(ctx, `
			SELECT s.id, s.scientific_name FROM species s
			LEFT JOIN species_images si ON si.species_id = s.id
			WHERE si.species_id IS NULL AND NOT s.extinct AND s.id <> ALL($2)
			ORDER BY EXISTS (SELECT 1 FROM region_species r WHERE r.species_id = s.id) DESC, s.seq -- Sierra Leone birds first
			LIMIT $1`, min(50, limit-done), retryLater)
		if err != nil {
			return found, missing, err
		}
		type sp struct {
			id  int64
			sci string
		}
		batch, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (sp, error) {
			var s sp
			return s, r.Scan(&s.id, &s.sci)
		})
		if err != nil || len(batch) == 0 {
			return found, missing, err
		}
		done += len(batch)

		titles := make([]string, len(batch))
		for i, s := range batch {
			titles[i] = s.sci
		}
		files, err := wc.pageImages(ctx, titles)
		if err != nil {
			return found, missing, err
		}
		var names []string
		for _, f := range files {
			if f != "" {
				names = append(names, f)
			}
		}
		info := map[string]commonsFile{}
		if len(names) > 0 {
			if info, err = wc.commonsInfo(ctx, names); err != nil {
				return found, missing, err
			}
		}

		var mu sync.Mutex
		var g errgroup.Group
		g.SetLimit(2) // polite parallelism for upload.wikimedia.org
		for _, s := range batch {
			f, ok := info[files[s.sci]]
			if !ok {
				a.markMissing(ctx, s.id)
				mu.Lock()
				missing++
				mu.Unlock()
				continue
			}
			g.Go(func() error {
				err := a.storeSpeciesImage(ctx, wc, s.id, f)
				mu.Lock()
				defer mu.Unlock()
				if err != nil {
					// Transient (network, rate limit, bad bytes): leave unmarked so the next run retries it.
					log.Printf("species %d (%s): %v (will retry on next run)", s.id, s.sci, err)
					failed++
					retryLater = append(retryLater, s.id)
					return nil
				}
				found++
				return nil
			})
		}
		g.Wait()
		log.Printf("seed-images: %d looked up, %d with photos, %d without, %d to retry", done, found, missing, failed)
	}
	return found, missing, nil
}

func (a *Server) markMissing(ctx context.Context, id int64) {
	if _, err := a.db.Exec(ctx, `INSERT INTO species_images (species_id, status) VALUES ($1, 'missing')
		ON CONFLICT (species_id) DO NOTHING`, id); err != nil {
		log.Printf("mark missing %d: %v", id, err)
	}
}

func (a *Server) storeSpeciesImage(ctx context.Context, wc *wikiClient, id int64, f commonsFile) error {
	raw, err := wc.download(ctx, f.ThumbURL)
	if err != nil {
		return err
	}
	full, thumb, w, h, err := storage.ProcessImageWithThumb(bytes.NewReader(raw), 800, 400)
	if err != nil {
		return err
	}
	prefix := "species/" + strconv.FormatInt(id, 10) + "/"
	key, thumbKey := storage.NewKey(prefix, ".jpg"), storage.NewKey(prefix+"thumb-", ".jpg")
	if err := a.media.PutJPEG(ctx, key, full); err != nil {
		return err
	}
	if err := a.media.PutJPEG(ctx, thumbKey, thumb); err != nil {
		a.media.Remove(ctx, key)
		return err
	}
	_, err = a.db.Exec(ctx, `
		INSERT INTO species_images (species_id, status, key, thumb_key, width, height, credit, licence, licence_url, source_url)
		VALUES ($1, 'ok', $2, $3, $4, $5, $6, $7, $8, $9)`,
		id, key, thumbKey, w, h, f.Credit, f.Licence, f.LicenceURL, f.SourceURL)
	if err != nil {
		a.media.Remove(ctx, key)
		a.media.Remove(ctx, thumbKey)
	}
	return err
}
