package api

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
)

// GAM-01 weekly challenges. Progress is measured from activity inside the challenge's week (Monday–Sunday, UTC,
// which is Sierra Leone time). Sighting challenges count only sightings the community has agreed on (community
// ID or verified), so they can't be met with made-up uploads (GAM-08). A completed challenge is worth
// challengeXP (GAM-02).

const challengeXP = 50

type challenge struct {
	ID          int64     `json:"id"`
	Week        time.Time `json:"week"`
	Kind        string    `json:"kind"`
	Param       string    `json:"param"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Goal        int       `json:"goal"`
	Progress    int       `json:"progress"`
	Done        bool      `json:"done"`
}

var challengeFamilies = []struct{ sci, name string }{
	{"Alcedinidae", "kingfishers"}, {"Nectariniidae", "sunbirds"}, {"Ploceidae", "weavers"}, {"Ardeidae", "herons"},
	{"Meropidae", "bee-eaters"}, {"Bucerotidae", "hornbills"}, {"Pycnonotidae", "bulbuls"}, {"Estrildidae", "waxbills"},
}

type challengeTemplate struct {
	kind, title, description string
	goal                     int
}

var challengeTemplates = []challengeTemplate{
	{"dawn_song", "Record a dawn song", "Post a sighting with a recording made before 8 am.", 1},
	{"new_site", "Somewhere new", "Log a sighting more than 1 km from anywhere you’ve logged before.", 1},
	{"species_week", "Ten species", "Log 10 different species this week.", 10},
	{"quiz_days", "Five quiz days", "Do a quiz on 5 different days this week.", 5},
	{"help_ids", "Helping hand", "Suggest the right ID on 5 of other people’s sightings.", 5},
}

// ensureWeek fills the week's three slots if they're empty: a family photo challenge, then two others,
// rotating through the templates week by week.
func (a *Server) ensureWeek(ctx context.Context, wk time.Time) error {
	n := int(wk.Sub(time.Date(2026, 1, 5, 0, 0, 0, 0, time.UTC)).Hours() / (24 * 7)) // weeks since a Monday
	n = (n%1000 + 1000) % 1000
	f := challengeFamilies[n%len(challengeFamilies)]
	rows := [][]any{{0, "family_photo", f.sci, fmt.Sprintf("Photograph 3 %s", f.name),
		fmt.Sprintf("Photograph 3 different species of %s this week.", f.name), 3}}
	for i := 0; i < 2; i++ {
		t := challengeTemplates[(2*n+i)%len(challengeTemplates)]
		rows = append(rows, []any{i + 1, t.kind, "", t.title, t.description, t.goal})
	}
	for _, r := range rows {
		if _, err := a.db.Exec(ctx, `INSERT INTO challenges (week, slot, kind, param, title, description, goal)
			VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (week, slot) DO NOTHING`, append([]any{wk}, r...)...); err != nil {
			return err
		}
	}
	return nil
}

// challengeProgress measures one person's progress on a challenge within its week.
func challengeProgress(ctx context.Context, q querier, uid int64, c challenge) (int, error) {
	const trusted = `o.user_id = $1 AND NOT o.hidden AND o.status IN ('community', 'verified')
		AND o.observed_at >= $2 AND o.observed_at < $2::date + 7`
	var sql string
	args := []any{uid, c.Week}
	switch c.Kind {
	case "family_photo":
		sql = `SELECT count(DISTINCT o.community_species_id) FROM observations o JOIN species s ON s.id = o.community_species_id
			WHERE ` + trusted + ` AND s.family_sci = $3 AND EXISTS (SELECT 1 FROM media m WHERE m.observation_id = o.id AND m.kind = 'photo')`
		args = append(args, c.Param)
	case "dawn_song":
		sql = `SELECT count(*) FROM observations o WHERE ` + trusted + ` AND extract(hour FROM o.observed_at AT TIME ZONE 'UTC') < 8
			AND EXISTS (SELECT 1 FROM media m WHERE m.observation_id = o.id AND m.kind = 'sound')`
	case "new_site": // ID doesn't matter here, only where
		sql = `SELECT count(*) FROM observations o WHERE o.user_id = $1 AND NOT o.hidden AND o.observed_at >= $2 AND o.observed_at < $2::date + 7
			AND NOT EXISTS (SELECT 1 FROM observations p WHERE p.user_id = $1 AND p.observed_at < $2 AND ST_DWithin(p.location, o.location, 1000))`
	case "species_week":
		sql = `SELECT count(DISTINCT o.community_species_id) FROM observations o WHERE ` + trusted
	case "quiz_days":
		sql = `SELECT count(*) FROM quiz_days WHERE user_id = $1 AND day >= $2 AND day < $2::date + 7`
	case "help_ids":
		sql = `SELECT count(*) FROM identifications i JOIN observations o ON o.id = i.observation_id
			WHERE i.user_id = $1 AND i.is_current AND i.created_at >= $2 AND i.created_at < $2::date + 7
			  AND o.user_id <> $1 AND NOT o.hidden AND o.status IN ('community', 'verified') AND i.species_id = o.community_species_id`
	default:
		return 0, nil
	}
	var n int
	err := q.QueryRow(ctx, sql, args...).Scan(&n)
	return n, err
}

// completedChallenges counts every challenge this person finished, for XP.
// ponytail: evaluates each past challenge (3 a week); keep a completions table if that gets slow.
func completedChallenges(ctx context.Context, q querier, uid int64) (int, error) {
	rows, err := q.Query(ctx, `SELECT id, week, kind, param, title, description, goal FROM challenges
		WHERE week + 7 > (SELECT created_at::date FROM users WHERE id = $1) ORDER BY week`, uid)
	if err != nil {
		return 0, err
	}
	all, err := pgx.CollectRows(rows, scanChallenge)
	if err != nil {
		return 0, err
	}
	done := 0
	for _, c := range all {
		p, err := challengeProgress(ctx, q, uid, c)
		if err != nil {
			return 0, err
		}
		if p >= c.Goal {
			done++
		}
	}
	return done, nil
}

func scanChallenge(row pgx.CollectableRow) (challenge, error) {
	var c challenge
	err := row.Scan(&c.ID, &c.Week, &c.Kind, &c.Param, &c.Title, &c.Description, &c.Goal)
	return c, err
}

// GET /challenges — this week's challenges, with the viewer's progress when signed in.
func (a *Server) weekChallenges(w http.ResponseWriter, r *http.Request) {
	wk := week(time.Now())
	if err := a.ensureWeek(r.Context(), wk); err != nil {
		internalError(w, "challenges", err)
		return
	}
	rows, err := a.db.Query(r.Context(), `SELECT id, week, kind, param, title, description, goal FROM challenges WHERE week = $1 ORDER BY slot`, wk)
	if err != nil {
		internalError(w, "challenges", err)
		return
	}
	items, err := pgx.CollectRows(rows, scanChallenge)
	if err != nil {
		internalError(w, "challenges", err)
		return
	}
	if uid := viewerID(r); uid != 0 {
		for i := range items {
			p, err := challengeProgress(r.Context(), a.db, uid, items[i])
			if err != nil {
				internalError(w, "challenge progress", err)
				return
			}
			items[i].Progress, items[i].Done = min(p, items[i].Goal), p >= items[i].Goal
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "ends": wk.AddDate(0, 0, 7), "xp": challengeXP})
}
