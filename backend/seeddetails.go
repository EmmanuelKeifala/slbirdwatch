package main

import (
	"context"
	"encoding/json"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// LIB-01: go run . seed-details [limit] — for each Sierra Leone species (region_species) without details yet,
// fetch the English Wikipedia article as plain text and the IUCN status from Wikidata. Resumable.

type textSection struct {
	Title string `json:"title"`
	Text  string `json:"text"`
}

var (
	wikiHeading  = regexp.MustCompile(`^(==+)\s*(.*?)\s*==+$`)
	skipHeadings = regexp.MustCompile(`(?i)^(taxonomy|systematics|etymology|references|external links|further reading|notes|citations|bibliography|sources|gallery|see also|cited|footnotes|in culture|relationship with humans)`)
	lengthCM     = regexp.MustCompile(`(\d+(?:\.\d+)?)(?:\s*(?:–|-|to)\s*(\d+(?:\.\d+)?))?\s*cm\b`)
	highlightFor = []struct {
		title string
		re    *regexp.Regexp
	}{
		{"Males and females", regexp.MustCompile(`(?i)\b(males?|females?|sexes|sexually)\b`)},
		{"Young birds", regexp.MustCompile(`(?i)\b(juveniles?|immatures?|young birds)\b`)},
		{"Through the year", regexp.MustCompile(`(?i)\b(breeding plumage|non-?breeding|eclipse|winter plumage|summer plumage|moults?|molts?)\b`)},
		{"Voice", regexp.MustCompile(`(?i)\b(calls?|songs?|sings|voice|vocali[sz]ations?|whistles?)\b`)},
	}
	iucnCodes = map[string]string{"Q211005": "LC", "Q719675": "NT", "Q278113": "VU", "Q11394": "EN",
		"Q219127": "CR", "Q3245245": "DD", "Q239509": "EW", "Q237350": "EX"}
)

// parseArticle splits a plain-text Wikipedia extract into sections (dropping taxonomy, references and the like,
// including their subsections), pulls out sentences about sexes, young, seasonal plumage and voice, and the length.
func parseArticle(extract string) (sections, highlights []textSection, length string) {
	sections, highlights = []textSection{}, []textSection{} // stored as [] rather than null
	cur := textSection{Title: "About"}
	skipLevel := 0 // >0 while inside a skipped section of that heading depth
	flush := func() {
		if t := strings.TrimSpace(cur.Text); t != "" {
			cur.Text = t
			sections = append(sections, cur)
		}
	}
	for _, line := range strings.Split(extract, "\n") {
		if m := wikiHeading.FindStringSubmatch(strings.TrimSpace(line)); m != nil {
			level := len(m[1])
			if skipLevel > 0 && level > skipLevel {
				continue
			}
			flush()
			cur, skipLevel = textSection{Title: m[2]}, 0
			if skipHeadings.MatchString(m[2]) {
				skipLevel = level
			}
			continue
		}
		if skipLevel == 0 && strings.TrimSpace(line) != "" {
			cur.Text += strings.TrimSpace(line) + "\n\n"
		}
	}
	flush()

	picked := make([][]string, len(highlightFor))
	for _, s := range sections {
		for _, sentence := range sentences(s.Text) {
			if length == "" && (s.Title == "Description" || s.Title == "About") {
				for _, m := range lengthCM.FindAllStringSubmatchIndex(sentence, -1) {
					if strings.Contains(strings.ToLower(sentence[max(0, m[0]-15):m[0]]), "wing") {
						continue // a wingspan, not the bird's length
					}
					length = sentence[m[2]:m[3]] + " cm"
					if m[4] >= 0 {
						length = sentence[m[2]:m[3]] + "–" + sentence[m[4]:m[5]] + " cm"
					}
					break
				}
			}
			for i, h := range highlightFor {
				if len(picked[i]) < 5 && h.re.MatchString(sentence) {
					picked[i] = append(picked[i], sentence)
				}
			}
		}
	}
	for i, h := range highlightFor {
		if len(picked[i]) > 0 {
			highlights = append(highlights, textSection{h.title, strings.Join(picked[i], " ")})
		}
	}
	return sections, highlights, length
}

// sentences splits on ". " + capital letter, keeping abbreviations like "P. b. dodsoni" together well enough.
func sentences(text string) []string {
	var out []string
	start := 0
	for i := 0; i+2 < len(text); i++ {
		if (text[i] == '.' || text[i] == '!' || text[i] == '?') && (text[i+1] == ' ' || text[i+1] == '\n') {
			j := i + 1
			for j < len(text) && (text[j] == ' ' || text[j] == '\n') {
				j++
			}
			if j < len(text) && text[j] >= 'A' && text[j] <= 'Z' && !(i >= 2 && text[i-2] == ' ') { // "P. b." initials
				out = append(out, strings.TrimSpace(text[start:i+1]))
				start = j
			}
		}
	}
	if rest := strings.TrimSpace(text[start:]); rest != "" {
		out = append(out, rest)
	}
	return out
}

type wikiArticle struct {
	title, extract, qid string
}

func (wc *wikiClient) article(ctx context.Context, title string) (*wikiArticle, error) {
	q := url.Values{"action": {"query"}, "format": {"json"}, "formatversion": {"2"}, "redirects": {"1"},
		"prop": {"extracts|pageprops"}, "explaintext": {"1"}, "ppprop": {"wikibase_item"}, "titles": {title}}
	var r struct {
		Query struct {
			Pages []struct {
				Title     string            `json:"title"`
				Missing   bool              `json:"missing"`
				Extract   string            `json:"extract"`
				PageProps map[string]string `json:"pageprops"`
			} `json:"pages"`
		} `json:"query"`
	}
	if err := wc.getJSON(ctx, wc.api("https://en.wikipedia.org")+"?"+q.Encode(), &r); err != nil {
		return nil, err
	}
	if len(r.Query.Pages) == 0 || r.Query.Pages[0].Missing || r.Query.Pages[0].Extract == "" {
		return nil, nil
	}
	p := r.Query.Pages[0]
	return &wikiArticle{p.Title, p.Extract, p.PageProps["wikibase_item"]}, nil
}

// iucnStatus returns IUCN codes (P141) for up to 50 Wikidata items.
func (wc *wikiClient) iucnStatus(ctx context.Context, qids []string) (map[string]string, error) {
	out := map[string]string{}
	if len(qids) == 0 {
		return out, nil
	}
	q := url.Values{"action": {"wbgetentities"}, "format": {"json"}, "props": {"claims"}, "ids": {strings.Join(qids, "|")}}
	base := "https://www.wikidata.org/w/api.php"
	if wc.base != "" {
		base = wc.base + "/wikidata/api.php"
	}
	var r struct {
		Entities map[string]struct {
			Claims map[string][]struct {
				Rank     string `json:"rank"`
				MainSnak struct {
					DataValue struct {
						Value json.RawMessage `json:"value"`
					} `json:"datavalue"`
				} `json:"mainsnak"`
			} `json:"claims"`
		} `json:"entities"`
	}
	if err := wc.getJSON(ctx, base+"?"+q.Encode(), &r); err != nil {
		return nil, err
	}
	for id, e := range r.Entities {
		for _, c := range e.Claims["P141"] {
			var v struct{ ID string }
			json.Unmarshal(c.MainSnak.DataValue.Value, &v)
			if code := iucnCodes[v.ID]; code != "" && (out[id] == "" || c.Rank == "preferred") {
				out[id] = code
			}
		}
	}
	return out, nil
}

func (a *server) seedDetails(ctx context.Context, wc *wikiClient, limit int) (found, missing int, err error) {
	rows, err := a.db.Query(ctx, `
		SELECT s.id, s.scientific_name FROM region_species r JOIN species s ON s.id = r.species_id
		WHERE NOT EXISTS (SELECT 1 FROM species_details d WHERE d.species_id = s.id)
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
	for start := 0; start < len(list); start += 25 {
		batch := list[start:min(start+25, len(list))]
		arts := map[int64]*wikiArticle{}
		var qids []string
		for _, t := range batch {
			art, err := wc.article(ctx, t.name)
			if err != nil {
				return found, missing, err
			}
			arts[t.id] = art
			if art != nil && art.qid != "" {
				qids = append(qids, art.qid)
			}
			time.Sleep(100 * time.Millisecond)
		}
		iucn, err := wc.iucnStatus(ctx, qids)
		if err != nil {
			return found, missing, err
		}
		for _, t := range batch {
			art := arts[t.id]
			if art == nil {
				missing++
				_, err = a.db.Exec(ctx, `INSERT INTO species_details (species_id, status) VALUES ($1, 'missing')`, t.id)
			} else {
				found++
				sections, highlights, length := parseArticle(art.extract)
				_, err = a.db.Exec(ctx, `
					INSERT INTO species_details (species_id, status, title, source_url, sections, highlights, length_text, iucn)
					VALUES ($1, 'ok', $2, $3, $4, $5, $6, $7)`,
					t.id, art.title, "https://en.wikipedia.org/wiki/"+url.PathEscape(strings.ReplaceAll(art.title, " ", "_")),
					sections, highlights, length, iucn[art.qid])
			}
			if err != nil {
				return found, missing, err
			}
		}
	}
	return found, missing, nil
}
