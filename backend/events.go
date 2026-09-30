package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// GAM-06 seasonal events: a window in which sightings count toward a shared total. Counting uses sightings
// observed in the window with an agreed ID (community or verified), not hidden, like the challenges.

type event struct {
	Slug        string    `json:"slug"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	StartsAt    time.Time `json:"starts_at"`
	EndsAt      time.Time `json:"ends_at"`
	Species     int       `json:"species"`   // community total so far
	Sightings   int       `json:"sightings"` // agreed sightings so far
	People      int       `json:"people"`
	Mine        *int      `json:"mine"` // the viewer's species, when signed in
}

const eventCounts = `
	(SELECT count(DISTINCT o.community_species_id)::int FROM observations o WHERE o.status IN ('community', 'verified') AND NOT o.hidden
	   AND o.observed_at >= e.starts_at AND o.observed_at < e.ends_at),
	(SELECT count(*)::int FROM observations o WHERE o.status IN ('community', 'verified') AND NOT o.hidden
	   AND o.observed_at >= e.starts_at AND o.observed_at < e.ends_at),
	(SELECT count(DISTINCT o.user_id)::int FROM observations o WHERE o.status IN ('community', 'verified') AND NOT o.hidden
	   AND o.observed_at >= e.starts_at AND o.observed_at < e.ends_at),
	CASE WHEN $1 = 0 THEN NULL ELSE (SELECT count(DISTINCT o.community_species_id)::int FROM observations o
	   WHERE o.user_id = $1 AND o.status IN ('community', 'verified') AND NOT o.hidden
	   AND o.observed_at >= e.starts_at AND o.observed_at < e.ends_at) END`

func scanEvent(row pgx.CollectableRow) (event, error) {
	var e event
	err := row.Scan(&e.Slug, &e.Title, &e.Description, &e.StartsAt, &e.EndsAt, &e.Species, &e.Sightings, &e.People, &e.Mine)
	return e, err
}

// GET /events — running and upcoming events (and those ended in the last 30 days), soonest first.
func (a *server) listEvents(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.Query(r.Context(), `SELECT e.slug, e.title, e.description, e.starts_at, e.ends_at, `+eventCounts+`
		FROM events e WHERE e.ends_at > now() - interval '30 days' ORDER BY (e.ends_at < now()), e.starts_at LIMIT 20`, viewerID(r))
	if err != nil {
		internalError(w, "events", err)
		return
	}
	items, err := pgx.CollectRows(rows, scanEvent)
	if err != nil {
		internalError(w, "events", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

type eventBirder struct {
	User    observer `json:"user"`
	Species int      `json:"species"`
}

// GET /events/{slug} — the event, its top counters (not private, not opted out of leaderboards, not blocked)
// and the species seen so far.
func (a *server) getEvent(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.Query(r.Context(), `SELECT e.slug, e.title, e.description, e.starts_at, e.ends_at, `+eventCounts+`
		FROM events e WHERE e.slug = $2`, viewerID(r), r.PathValue("slug"))
	if err != nil {
		internalError(w, "event", err)
		return
	}
	e, err := pgx.CollectExactlyOneRow(rows, scanEvent)
	if errors.Is(err, pgx.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		internalError(w, "event", err)
		return
	}
	rows, err = a.db.Query(r.Context(), `
		SELECT u.id, u.display_name, u.avatar_key, count(DISTINCT o.community_species_id)::int
		FROM observations o JOIN users u ON u.id = o.user_id
		WHERE o.status IN ('community', 'verified') AND NOT o.hidden AND o.observed_at >= $2 AND o.observed_at < $3
		  AND NOT u.private_profile AND NOT u.hide_from_leaderboards AND `+notBlocked("u.id")+`
		GROUP BY u.id ORDER BY 4 DESC, u.id LIMIT 10`, viewerID(r), e.StartsAt, e.EndsAt)
	if err != nil {
		internalError(w, "event birders", err)
		return
	}
	top, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (eventBirder, error) {
		var b eventBirder
		var avatar *string
		err := row.Scan(&b.User.ID, &b.User.DisplayName, &avatar, &b.Species)
		if avatar != nil {
			u := a.media.url(*avatar)
			b.User.AvatarURL = &u
		}
		return b, err
	})
	if err != nil {
		internalError(w, "event birders", err)
		return
	}
	rows, err = a.db.Query(r.Context(), `
		SELECT s.id, s.english_name, s.scientific_name FROM species s WHERE s.id IN (
			SELECT o.community_species_id FROM observations o WHERE o.status IN ('community', 'verified') AND NOT o.hidden
			AND o.observed_at >= $1 AND o.observed_at < $2) AND NOT s.sensitive ORDER BY s.seq`, e.StartsAt, e.EndsAt)
	if err != nil {
		internalError(w, "event species", err)
		return
	}
	species, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (speciesRef, error) {
		var s speciesRef
		return s, row.Scan(&s.ID, &s.EnglishName, &s.ScientificName)
	})
	if err != nil {
		internalError(w, "event species", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"event": e, "top": top, "species_list": species})
}

// PUT /admin/events/{slug} {title, description, starts_at, ends_at} (admin) — create or replace.
func (a *server) putEvent(w http.ResponseWriter, r *http.Request) {
	var e event
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&e); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	e.Title, e.Description = strings.TrimSpace(e.Title), strings.TrimSpace(e.Description)
	if !slugRe.MatchString(r.PathValue("slug")) || len([]rune(e.Title)) < 2 || len([]rune(e.Title)) > 80 ||
		len([]rune(e.Description)) > 500 || !e.EndsAt.After(e.StartsAt) || e.EndsAt.Sub(e.StartsAt) > 120*24*time.Hour {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "short name, title 2–80, description up to 500, and an end after the start (at most 120 days)"})
		return
	}
	if _, err := a.db.Exec(r.Context(), `INSERT INTO events (slug, title, description, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (slug) DO UPDATE SET title = $2, description = $3, starts_at = $4, ends_at = $5`,
		r.PathValue("slug"), e.Title, e.Description, e.StartsAt, e.EndsAt); err != nil {
		internalError(w, "put event", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DELETE /admin/events/{slug} (admin)
func (a *server) deleteEvent(w http.ResponseWriter, r *http.Request) {
	tag, err := a.db.Exec(r.Context(), `DELETE FROM events WHERE slug = $1`, r.PathValue("slug"))
	if err != nil {
		internalError(w, "delete event", err)
		return
	}
	if tag.RowsAffected() == 0 {
		http.NotFound(w, r)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
