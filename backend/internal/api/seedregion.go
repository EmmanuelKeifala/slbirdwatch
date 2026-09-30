package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// OBS-06: which birds are recorded in Sierra Leone, and in which months, from GBIF occurrence records
// (open data, no API key). go run ./cmd/birdwatch seed-region replaces region_species each run.

const regionCountry = "SL" // Sierra Leone

type gbifClient struct {
	http *http.Client
	base string // overridable in tests
	gap  time.Duration
}

func newGBIFClient() *gbifClient {
	return &gbifClient{http: &http.Client{Timeout: 60 * time.Second}, base: "https://api.gbif.org", gap: 100 * time.Millisecond}
}

type regionTally struct {
	gbifKey int64
	family  string
	months  [12]int
	total   int
}

// tallyRegion counts the country's bird records per species (GBIF's accepted species) and month:
// one facet query per month plus a name lookup per species, far lighter than paging every record.
func (g *gbifClient) tallyRegion(ctx context.Context) (map[string]*regionTally, error) {
	byKey := map[string]*regionTally{}
	for m := 0; m <= 12; m++ { // 0 = all months, so records without a month still count
		q := url.Values{"country": {regionCountry}, "classKey": {"212"}, "occurrenceStatus": {"PRESENT"},
			"hasGeospatialIssue": {"false"}, "limit": {"0"}, "facet": {"speciesKey"}, "facetLimit": {"5000"}}
		if m > 0 {
			q.Set("month", fmt.Sprint(m))
		}
		var page struct {
			Facets []struct {
				Counts []struct {
					Name  string `json:"name"`
					Count int    `json:"count"`
				} `json:"counts"`
			} `json:"facets"`
		}
		if err := g.get(ctx, "/v1/occurrence/search?"+q.Encode(), &page); err != nil {
			return nil, err
		}
		for _, f := range page.Facets {
			for _, c := range f.Counts {
				t := byKey[c.Name]
				if t == nil {
					t = &regionTally{}
					byKey[c.Name] = t
				}
				if m == 0 {
					t.total = c.Count
				} else {
					t.months[m-1] = c.Count
				}
			}
		}
	}
	out := map[string]*regionTally{}
	for key, t := range byKey {
		var sp struct {
			CanonicalName string `json:"canonicalName"`
			Family        string `json:"family"`
		}
		if err := g.get(ctx, "/v1/species/"+url.PathEscape(key), &sp); err != nil {
			return nil, err
		}
		if t.total > 0 && sp.CanonicalName != "" {
			t.family = sp.Family
			t.gbifKey, _ = strconv.ParseInt(key, 10, 64)
			out[sp.CanonicalName] = t
		}
	}
	return out, nil
}

// get fetches one GBIF API path as JSON, retrying (GBIF resets connections now and then) and pausing politely.
func (g *gbifClient) get(ctx context.Context, path string, v any) error {
	var err error
	for try := 1; try <= 4; try++ {
		if err = g.getOnce(ctx, path, v); err == nil {
			time.Sleep(g.gap)
			return nil
		}
		time.Sleep(time.Duration(try) * 2 * g.gap)
	}
	return err
}

func (g *gbifClient) getOnce(ctx context.Context, path string, v any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, g.base+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "SLBirdwatch/0.1 seed-region")
	resp, err := g.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("gbif %s: %s", path, resp.Status)
	}
	if err := json.NewDecoder(resp.Body).Decode(v); err != nil {
		return fmt.Errorf("gbif %s: %w", path, err)
	}
	return nil
}

// gbifToIOC: Sierra Leone species whose GBIF name the automatic match misses (typos, moved genus and family,
// or lumped by IOC; lumped ones add their records to the IOC species).
var gbifToIOC = map[string]string{
	"Phylloscopus sibillatrix":    "Phylloscopus sibilatrix",
	"Tringa ocrophus":             "Tringa ochropus",
	"Bubo leucostictus":           "Ketupa leucosticta",
	"Bubo lacteus":                "Ketupa lactea",
	"Coracina azurea":             "Cyanograucalus azureus",
	"Accipiter minullus":          "Tachyspiza minulla",
	"Accipiter badius":            "Tachyspiza badia",
	"Accipiter toussenelii":       "Aerospiza tachiro",
	"Myioparus plumbeus":          "Fraseria plumbea",
	"Spermospiza haematina":       "Spermophaga haematina",
	"Ploceus superciliosus":       "Pachyphantes superciliosus",
	"Pyromelana flammiceps":       "Euplectes franciscanus",
	"Dicrurus occidentalis":       "Dicrurus ludwigii",
	"Lonchura bicolor":            "Spermestes bicolor",
	"Salpornis spilonotus":        "Salpornis salvadori",
	"Caprimulgus nigriscapularis": "Caprimulgus pectoralis",
	"Milvus aegyptius":            "Milvus migrans",
	"Pseudalethe poliocephala":    "Chamaetylas poliocephala",
	"Heliolais erythropterus":     "Prinia erythroptera",
}

// seedRegion stores the tally against our (IOC) species. GBIF's backbone sometimes uses another genus
// (Bubulcus ibis vs IOC Ardea ibis), so an unmatched name falls back to the same epithet in the same family.
func (a *Server) seedRegion(ctx context.Context, g *gbifClient) (matched int, unmatched []string, err error) {
	tally, err := g.tallyRegion(ctx)
	if err != nil {
		return 0, nil, err
	}
	tx, err := a.db.Begin(ctx)
	if err != nil {
		return 0, nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM region_species`); err != nil {
		return 0, nil, err
	}
	for name, t := range tally {
		if ioc, ok := gbifToIOC[name]; ok {
			name = ioc
		}
		epithet := name[strings.LastIndex(name, " ")+1:]
		tag, err := tx.Exec(ctx, `
			INSERT INTO region_species (species_id, records, months, gbif_key)
			SELECT id, $3, $4, $6 FROM (
				SELECT id FROM species WHERE scientific_name = $1
				UNION ALL
				(SELECT min(id) FROM species WHERE NOT EXISTS (SELECT 1 FROM species WHERE scientific_name = $1)
				   AND family_sci = $2 AND split_part(scientific_name, ' ', 2) = $5
				 HAVING count(*) = 1)
			) m
			ON CONFLICT (species_id) DO UPDATE SET records = region_species.records + excluded.records,
				months = (SELECT array_agg(a + b ORDER BY i) FROM unnest(region_species.months, excluded.months)
				          WITH ORDINALITY AS u(a, b, i))`,
			name, t.family, t.total, t.months[:], epithet, t.gbifKey)
		if err != nil {
			return 0, nil, err
		}
		if tag.RowsAffected() == 0 {
			unmatched = append(unmatched, name)
		} else {
			matched++
		}
	}
	return matched, unmatched, tx.Commit(ctx)
}
