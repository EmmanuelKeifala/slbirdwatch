package api

import (
	"errors"
	"html/template"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/slbirdwatch/backend/internal/config"
)

// LIB-14: public web pages for a species (/s/{id}) and a sighting (/o/{id}), for sharing: readable in any
// browser, with a link preview (Open Graph) and a button that opens the app. Sightings follow the app's
// rules for a signed-out viewer: hidden ones 404, and no coordinates are shown at all.

var sharePage = template.Must(template.New("share").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{.Title}} · SL Birdwatch</title>
<meta property="og:title" content="{{.Title}}"><meta property="og:description" content="{{.Summary}}">
{{if .Image}}<meta property="og:image" content="{{.Image}}">{{end}}<meta property="og:site_name" content="SL Birdwatch">
<style>
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#F7F6FB;color:#17144B}
main{max-width:640px;margin:0 auto;padding:16px}
img.hero{width:100%;border-radius:20px;display:block;aspect-ratio:4/3;object-fit:cover;background:#E8E6F5}
h1{font-size:30px;margin:18px 0 2px}.sci{font-style:italic;color:#5F5B85;margin:0 0 12px}
.meta{color:#5F5B85;font-size:14px;margin:4px 0}.credit{color:#8C88AE;font-size:12px}
p{line-height:1.55}.pill{display:inline-block;background:#E9E5FF;border-radius:999px;padding:4px 12px;font-size:13px;margin:4px 6px 4px 0}
a.open{display:block;text-align:center;background:#17144B;color:#fff;text-decoration:none;border-radius:999px;padding:14px;font-weight:600;margin:24px 0 8px}
footer{color:#8C88AE;font-size:12px;text-align:center;margin:24px 0}
</style></head><body><main>
{{if .Image}}<img class="hero" src="{{.Image}}" alt="{{.Title}}">{{if .Credit}}<div class="credit">{{.Credit}}</div>{{end}}{{end}}
<h1>{{.Title}}</h1>{{if .Sci}}<p class="sci">{{.Sci}}</p>{{end}}
{{range .Meta}}<div class="meta">{{.}}</div>{{end}}
{{if .Pills}}<div>{{range .Pills}}<span class="pill">{{.}}</span>{{end}}</div>{{end}}
{{range .Paras}}<p>{{.}}</p>{{end}}
<a class="open" href="{{.AppLink}}">Open in SL Birdwatch</a>
<footer>SL Birdwatch · learn the birds of Sierra Leone</footer>
</main></body></html>`))

type shareData struct {
	Title, Sci, Summary, Image, Credit string
	AppLink                            template.URL // our own app link, built here (html/template would blank the custom scheme)
	Meta, Pills, Paras                 []string
}

// absolute turns a media path into a full URL for link previews (PUBLIC_URL, else this request's host).
func absolute(r *http.Request, u string) string {
	if u == "" || !strings.HasPrefix(u, "/") {
		return u
	}
	base := config.Env("PUBLIC_URL", "")
	if base == "" {
		scheme := "http"
		if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
			scheme = "https"
		}
		base = scheme + "://" + r.Host
	}
	return strings.TrimRight(base, "/") + u
}

func renderShare(w http.ResponseWriter, d shareData) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=300")
	sharePage.Execute(w, d)
}

// GET /s/{id} — a species.
func (a *Server) shareSpecies(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	sp, err := a.loadSpeciesDetail(r.Context(), id)
	if err != nil {
		internalError(w, "share species", err)
		return
	}
	if sp == nil {
		http.NotFound(w, r)
		return
	}
	d := shareData{Title: sp.EnglishName, Sci: sp.ScientificName, AppLink: template.URL("slbirdwatch://species/" + strconv.FormatInt(id, 10)),
		Meta: []string{sp.FamilyEn + " · " + sp.FamilySci}}
	d.Summary = sp.EnglishName + ", a bird of the " + strings.ToLower(sp.FamilyEn) + " family."
	if sp.Image != nil {
		d.Image, d.Credit = absolute(r, sp.Image.URL), "Photo: "+sp.Image.Credit+" · "+sp.Image.Licence
	}
	for _, n := range sp.LocalNames {
		d.Pills = append(d.Pills, n.Name+" ("+n.Language+")")
	}
	if sp.Region != nil {
		d.Meta = append(d.Meta, strconv.Itoa(sp.Region.Records)+" records in Sierra Leone on GBIF.org")
	}
	if sp.Details != nil {
		for _, h := range sp.Details.Highlights {
			d.Paras = append(d.Paras, h.Title+": "+h.Text)
		}
		if len(d.Paras) == 0 && len(sp.Details.Sections) > 0 {
			d.Paras = append(d.Paras, sp.Details.Sections[0].Text)
		}
		if len(d.Paras) > 0 {
			d.Summary = d.Paras[0]
			d.Paras = append(d.Paras, "Text from Wikipedia ("+sp.Details.Licence+").")
		}
	}
	renderShare(w, d)
}

// GET /o/{id} — a sighting, as a signed-out visitor would see it.
func (a *Server) shareObservation(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	o, err := a.scanObservation(a.db.QueryRow(r.Context(), observationSelect+` WHERE o.id = $1 AND NOT o.hidden`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		internalError(w, "share observation", err)
		return
	}
	one := []observation{o}
	if err := a.withPhotos(r.Context(), one); err != nil {
		internalError(w, "share observation", err)
		return
	}
	o = one[0]
	sp := o.CommunitySpecies
	if sp == nil {
		sp = o.Species
	}
	d := shareData{Title: "A bird sighting", AppLink: template.URL("slbirdwatch://sighting/" + strconv.FormatInt(id, 10))}
	if sp != nil {
		d.Title, d.Sci = sp.EnglishName, sp.ScientificName
	}
	status := map[string]string{"needs_id": "Needs an ID", "community": "Community ID", "verified": "Verified"}[o.Status]
	d.Meta = []string{"Seen by " + o.Observer.DisplayName + " on " + o.ObservedAt.Format("2 January 2006"), status}
	if o.Site != nil && o.cell == 0 {
		d.Meta = append(d.Meta, "At "+o.Site.Name)
	}
	d.Summary = d.Title + " seen by " + o.Observer.DisplayName + " in Sierra Leone"
	if len(o.Photos) > 0 {
		d.Image, d.Credit = absolute(r, o.Photos[0].URL), "Photo: "+o.Observer.DisplayName
	}
	if o.Notes != "" {
		d.Paras = []string{o.Notes}
	}
	renderShare(w, d)
}
