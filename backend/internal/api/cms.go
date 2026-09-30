package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ADM-05: admins write lessons and weekly challenges.

var slugRe = regexp.MustCompile(`^[a-z0-9-]{2,40}$`)

// GET /admin/lessons — every lesson, hidden ones too, in order.
func (a *Server) adminLessons(w http.ResponseWriter, r *http.Request) {
	items, err := a.loadLessons(r.Context(), true)
	if err != nil {
		internalError(w, "admin lessons", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// PUT /admin/lessons/{slug} {title, blurb, families, species_ids, position, published} — create or replace.
func (a *Server) putLesson(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	var l lessonDef
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384)).Decode(&l); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	l.Title, l.Blurb = strings.TrimSpace(l.Title), strings.TrimSpace(l.Blurb)
	bad := func(msg string) { writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg}) }
	switch {
	case !slugRe.MatchString(slug):
		bad("the short name is 2–40 lowercase letters, digits or dashes")
		return
	case len([]rune(l.Title)) < 2 || len([]rune(l.Title)) > 80:
		bad("the title is 2–80 characters")
		return
	case len([]rune(l.Blurb)) > 300:
		bad("the description is at most 300 characters")
		return
	case len(l.SpeciesIDs) > 12:
		bad("a lesson has at most 12 birds")
		return
	}
	l.Families = slices.Compact(slices.Sorted(slices.Values(l.Families)))
	ids := slices.Compact(slices.Sorted(slices.Values(l.SpeciesIDs)))
	var fams, birds int
	if err := a.db.QueryRow(r.Context(), `SELECT (SELECT count(DISTINCT family_sci) FROM species WHERE family_sci = ANY($1)),
		(SELECT count(*) FROM species WHERE id = ANY($2) AND merged_into IS NULL)`, l.Families, ids).Scan(&fams, &birds); err != nil {
		internalError(w, "put lesson", err)
		return
	}
	if fams != len(l.Families) || birds != len(ids) || len(ids) != len(l.SpeciesIDs) {
		bad("unknown family or bird, or a bird listed twice")
		return
	}
	if l.Families == nil {
		l.Families = []string{}
	}
	if l.SpeciesIDs == nil {
		l.SpeciesIDs = []int64{}
	}
	_, err := a.db.Exec(r.Context(), `
		INSERT INTO lessons (slug, title, blurb, families, species_ids, position, published) VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (slug) DO UPDATE SET title = $2, blurb = $3, families = $4, species_ids = $5, position = $6, published = $7, updated_at = now()`,
		slug, l.Title, l.Blurb, l.Families, l.SpeciesIDs, l.Position, l.Published)
	if err != nil {
		internalError(w, "put lesson", err)
		return
	}
	l.Slug = slug
	writeJSON(w, http.StatusOK, l)
}

// DELETE /admin/lessons/{slug}
func (a *Server) deleteLesson(w http.ResponseWriter, r *http.Request) {
	tag, err := a.db.Exec(r.Context(), `DELETE FROM lessons WHERE slug = $1`, r.PathValue("slug"))
	if err != nil {
		internalError(w, "delete lesson", err)
		return
	}
	if tag.RowsAffected() == 0 {
		http.NotFound(w, r)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GET /admin/challenges — this week and the next three (filled from templates where empty), for editing.
func (a *Server) adminChallenges(w http.ResponseWriter, r *http.Request) {
	wk := week(time.Now())
	for i := 0; i < 4; i++ {
		if err := a.ensureWeek(r.Context(), wk.AddDate(0, 0, 7*i)); err != nil {
			internalError(w, "admin challenges", err)
			return
		}
	}
	rows, err := a.db.Query(r.Context(), `SELECT id, week, kind, param, title, description, goal FROM challenges
		WHERE week >= $1 AND week < $1::date + 28 ORDER BY week, slot`, wk)
	if err != nil {
		internalError(w, "admin challenges", err)
		return
	}
	items, err := pgx.CollectRows(rows, scanChallenge)
	if err != nil {
		internalError(w, "admin challenges", err)
		return
	}
	kinds := []map[string]string{}
	for _, t := range challengeTemplates {
		kinds = append(kinds, map[string]string{"kind": t.kind, "title": t.title})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "kinds": append([]map[string]string{{"kind": "family_photo", "title": "Photograph birds of a family"}}, kinds...)})
}

// PUT /admin/challenges/{id} {kind, param, title, description, goal} — this week's or a later one only, so XP
// already earned never changes.
func (a *Server) putChallenge(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	var c challenge
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&c); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	c.Title, c.Description = strings.TrimSpace(c.Title), strings.TrimSpace(c.Description)
	if c.Kind != "family_photo" {
		c.Param = ""
	}
	if len([]rune(c.Title)) < 2 || len([]rune(c.Title)) > 60 || len([]rune(c.Description)) > 200 || c.Goal < 1 || c.Goal > 50 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "title 2–60 characters, description up to 200, goal 1–50"})
		return
	}
	if c.Kind == "family_photo" {
		var ok bool
		a.db.QueryRow(r.Context(), `SELECT EXISTS (SELECT 1 FROM species WHERE family_sci = $1)`, c.Param).Scan(&ok)
		if !ok {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "pick a bird family"})
			return
		}
	}
	tag, err := a.db.Exec(r.Context(), `UPDATE challenges SET kind = $2, param = $3, title = $4, description = $5, goal = $6
		WHERE id = $1 AND week >= $7`, id, c.Kind, c.Param, c.Title, c.Description, c.Goal, week(time.Now()))
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23514" { // kind check
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown challenge kind"})
		return
	}
	if err != nil {
		internalError(w, "put challenge", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such challenge, or its week is over"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
