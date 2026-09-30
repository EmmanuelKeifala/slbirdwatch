package api

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

// ADM-01 moderation (moderator+): a queue of flagged sightings and reported people, and actions on them.
// Every action is written to moderation_actions. Hidden sightings disappear from every public view but stay
// visible to their observer; banned or suspended people are signed out everywhere and can't sign in.

type flaggedSighting struct {
	ID          int64          `json:"id"`
	Species     string         `json:"species"` // shown species, "" when unknown
	ThumbURL    *string        `json:"thumb_url"`
	Observer    observer       `json:"observer"`
	Hidden      bool           `json:"hidden"`
	Reasons     map[string]int `json:"reasons"`
	Notes       []string       `json:"notes"`
	FirstFlagAt time.Time      `json:"first_flagged_at"`
}

type reportedPerson struct {
	User           observer       `json:"user"`
	Banned         bool           `json:"banned"`
	SuspendedUntil *time.Time     `json:"suspended_until"`
	Reasons        map[string]int `json:"reasons"`
	Notes          []string       `json:"notes"`
	Warnings       int            `json:"warnings"`
	FirstReportAt  time.Time      `json:"first_reported_at"`
}

// GET /mod/queue — open flags grouped by sighting, open reports grouped by person; oldest first.
func (a *Server) modQueue(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.Query(r.Context(), `
		SELECT o.id, coalesce(cs.english_name, s.english_name, ''), coalesce(m.thumb_key, si.thumb_key),
		       u.id, u.display_name, u.avatar_key, o.hidden,
		       jsonb_object_agg(f.reason, f.n), (SELECT array_agg(note) FROM flags WHERE observation_id = o.id AND status = 'open' AND note <> ''),
		       min(f.first)
		FROM (SELECT observation_id, reason::text, count(*) AS n, min(created_at) AS first FROM flags WHERE status = 'open'
		      GROUP BY observation_id, reason) f
		JOIN observations o ON o.id = f.observation_id
		JOIN users u ON u.id = o.user_id
		LEFT JOIN species s ON s.id = o.species_id
		LEFT JOIN species cs ON cs.id = o.community_species_id
		LEFT JOIN species_images si ON si.species_id = coalesce(cs.id, s.id) AND si.status = 'ok'
		LEFT JOIN LATERAL (SELECT thumb_key FROM media WHERE observation_id = o.id AND kind = 'photo' ORDER BY id LIMIT 1) m ON true
		GROUP BY o.id, cs.english_name, s.english_name, m.thumb_key, si.thumb_key, u.id
		ORDER BY min(f.first) LIMIT 100`)
	if err != nil {
		internalError(w, "mod queue", err)
		return
	}
	sightings, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (flaggedSighting, error) {
		var f flaggedSighting
		var thumb, avatar *string
		var notes []string
		err := row.Scan(&f.ID, &f.Species, &thumb, &f.Observer.ID, &f.Observer.DisplayName, &avatar, &f.Hidden, &f.Reasons, &notes, &f.FirstFlagAt)
		f.ThumbURL, f.Observer.AvatarURL, f.Notes = a.mediaURL(thumb), a.mediaURL(avatar), orEmpty(notes)
		return f, err
	})
	if err != nil {
		internalError(w, "mod queue", err)
		return
	}
	rows, err = a.db.Query(r.Context(), `
		SELECT u.id, u.display_name, u.avatar_key, u.banned, u.suspended_until,
		       jsonb_object_agg(rp.reason, rp.n),
		       (SELECT array_agg(note) FROM user_reports WHERE reported_id = u.id AND status = 'open' AND note <> ''),
		       (SELECT count(*) FROM moderation_actions WHERE target_type = 'user' AND target_id = u.id AND action = 'warn'),
		       min(rp.first)
		FROM (SELECT reported_id, reason::text, count(*) AS n, min(created_at) AS first FROM user_reports WHERE status = 'open'
		      GROUP BY reported_id, reason) rp
		JOIN users u ON u.id = rp.reported_id
		GROUP BY u.id ORDER BY min(rp.first) LIMIT 100`)
	if err != nil {
		internalError(w, "mod queue", err)
		return
	}
	people, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (reportedPerson, error) {
		var p reportedPerson
		var avatar *string
		var notes []string
		err := row.Scan(&p.User.ID, &p.User.DisplayName, &avatar, &p.Banned, &p.SuspendedUntil, &p.Reasons, &notes, &p.Warnings, &p.FirstReportAt)
		p.User.AvatarURL, p.Notes = a.mediaURL(avatar), orEmpty(notes)
		return p, err
	})
	if err != nil {
		internalError(w, "mod queue", err)
		return
	}
	// VER-09: reported comments, most reported first.
	rows, err = a.db.Query(r.Context(), `
		SELECT c.id, c.observation_id, c.body, c.hidden, u.id, u.display_name, u.avatar_key,
		       jsonb_object_agg(cr.reason, cr.n), sum(cr.n)::int
		FROM (SELECT comment_id, reason, count(*) AS n FROM comment_reports WHERE status = 'open' GROUP BY comment_id, reason) cr
		JOIN comments c ON c.id = cr.comment_id JOIN users u ON u.id = c.user_id
		GROUP BY c.id, u.id ORDER BY sum(cr.n) DESC, c.id LIMIT 100`)
	if err != nil {
		internalError(w, "mod queue", err)
		return
	}
	type reportedComment struct {
		ID          int64          `json:"id"`
		Observation int64          `json:"observation_id"`
		Body        string         `json:"body"`
		Hidden      bool           `json:"hidden"`
		Author      observer       `json:"author"`
		Reasons     map[string]int `json:"reasons"`
		Reports     int            `json:"reports"`
	}
	comments, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (reportedComment, error) {
		var c reportedComment
		var avatar *string
		err := row.Scan(&c.ID, &c.Observation, &c.Body, &c.Hidden, &c.Author.ID, &c.Author.DisplayName, &avatar, &c.Reasons, &c.Reports)
		c.Author.AvatarURL = a.mediaURL(avatar)
		return c, err
	})
	if err != nil {
		internalError(w, "mod queue", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sightings": sightings, "people": people, "comments": comments})
}

func orEmpty(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

type modAction struct {
	Action string `json:"action"`
	Days   int    `json:"days"` // suspend only, 1–365
	Note   string `json:"note"`
}

func readModAction(w http.ResponseWriter, r *http.Request, allowed ...string) (int64, modAction, bool) {
	var m modAction
	id, ok := pathID(w, r, "id")
	if !ok {
		return 0, m, false
	}
	if !readJSON(w, r, 4096, &m) {
		return 0, m, false
	}
	switch {
	case !slices.Contains(allowed, m.Action):
		writeError(w, http.StatusBadRequest, "unknown action "+m.Action)
	case len(m.Note) > 1000:
		writeError(w, http.StatusBadRequest, "note is too long (1000 characters max)")
	case m.Action == "suspend" && (m.Days < 1 || m.Days > 365):
		writeError(w, http.StatusBadRequest, "days must be 1–365")
	default:
		return id, m, true
	}
	return 0, m, false
}

// POST /mod/observations/{id} {action: hide|restore|remove|dismiss, note}
// hide/remove resolve the open flags, dismiss dismisses them, restore un-hides.
func (a *Server) moderateObservation(w http.ResponseWriter, r *http.Request) {
	id, m, ok := readModAction(w, r, "hide", "restore", "remove", "dismiss")
	if !ok {
		return
	}
	var keys []string
	err := pgx.BeginFunc(r.Context(), a.db, func(tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(r.Context(), `SELECT true FROM observations WHERE id = $1 FOR UPDATE`, id).Scan(&exists); err != nil {
			return err
		}
		var err error
		switch m.Action {
		case "hide":
			_, err = tx.Exec(r.Context(), `UPDATE observations SET hidden = true WHERE id = $1`, id)
		case "restore":
			_, err = tx.Exec(r.Context(), `UPDATE observations SET hidden = false WHERE id = $1`, id)
		case "remove":
			if keys, err = mediaKeys(r.Context(), tx, `SELECT key, thumb_key FROM media WHERE observation_id = $1`, id); err == nil {
				_, err = tx.Exec(r.Context(), `DELETE FROM observations WHERE id = $1`, id)
			}
		}
		if err != nil {
			return err
		}
		if status := map[string]string{"hide": "resolved", "dismiss": "dismissed"}[m.Action]; status != "" {
			if _, err := tx.Exec(r.Context(), `UPDATE flags SET status = $2, closed_at = now() WHERE observation_id = $1 AND status = 'open'`, id, status); err != nil {
				return err
			}
		}
		_, err = tx.Exec(r.Context(), `INSERT INTO moderation_actions (moderator_id, target_type, target_id, action, note)
			VALUES ($1, 'observation', $2, $3, $4)`, userID(r), id, m.Action, m.Note)
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		internalError(w, "moderate observation", err)
		return
	}
	for _, k := range keys {
		a.media.Remove(r.Context(), k)
	}
	w.WriteHeader(http.StatusNoContent)
}

// POST /mod/users/{id} {action: warn|suspend|ban|unban|dismiss, days, note}
// Only people with a lower role can be moderated. warn/suspend/ban resolve open reports; dismiss dismisses them.
func (a *Server) moderateUser(w http.ResponseWriter, r *http.Request) {
	id, m, ok := readModAction(w, r, "warn", "suspend", "ban", "unban", "dismiss")
	if !ok {
		return
	}
	var mine, theirs string
	err := a.db.QueryRow(r.Context(), `SELECT (SELECT role::text FROM users WHERE id = $1), role::text FROM users WHERE id = $2`,
		userID(r), id).Scan(&mine, &theirs)
	if errors.Is(err, pgx.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		internalError(w, "moderate user", err)
		return
	}
	if roleAtLeast(theirs, mine) {
		writeError(w, http.StatusForbidden, "you can only moderate people with a lower role")
		return
	}
	err = pgx.BeginFunc(r.Context(), a.db, func(tx pgx.Tx) error {
		var err error
		switch m.Action {
		case "suspend":
			_, err = tx.Exec(r.Context(), `UPDATE users SET suspended_until = now() + make_interval(days => $2) WHERE id = $1`, id, m.Days)
		case "ban":
			_, err = tx.Exec(r.Context(), `UPDATE users SET banned = true WHERE id = $1`, id)
		case "unban":
			_, err = tx.Exec(r.Context(), `UPDATE users SET banned = false, suspended_until = NULL WHERE id = $1`, id)
		}
		if err != nil {
			return err
		}
		status := map[string]string{"warn": "resolved", "suspend": "resolved", "ban": "resolved", "dismiss": "dismissed"}[m.Action]
		if status != "" {
			if _, err := tx.Exec(r.Context(), `UPDATE user_reports SET status = $2, closed_at = now() WHERE reported_id = $1 AND status = 'open'`, id, status); err != nil {
				return err
			}
		}
		note := m.Note
		if m.Action == "suspend" {
			note = strconv.Itoa(m.Days) + " days. " + note
		}
		_, err = tx.Exec(r.Context(), `INSERT INTO moderation_actions (moderator_id, target_type, target_id, action, note)
			VALUES ($1, 'user', $2, $3, $4)`, userID(r), id, m.Action, note)
		return err
	})
	if err != nil {
		internalError(w, "moderate user", err)
		return
	}
	if m.Action == "suspend" || m.Action == "ban" {
		if err := a.revokeAllSessions(r.Context(), id); err != nil {
			internalError(w, "revoke sessions", err)
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// latestWarning is the newest moderator warning from the last 30 days, shown to the person on /me.
func (a *Server) latestWarning(ctx context.Context, id int64) (*modWarning, error) {
	var wn modWarning
	err := a.db.QueryRow(ctx, `SELECT note, created_at FROM moderation_actions
		WHERE target_type = 'user' AND target_id = $1 AND action = 'warn' AND created_at > now() - interval '30 days'
		ORDER BY created_at DESC LIMIT 1`, id).Scan(&wn.Note, &wn.At)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &wn, err
}

type modWarning struct {
	Note string    `json:"note"`
	At   time.Time `json:"at"`
}

func mediaKeys(ctx context.Context, q interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, sql string, args ...any) ([]string, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	var keys []string
	for rows.Next() {
		var k string
		var t *string
		if err := rows.Scan(&k, &t); err != nil {
			rows.Close()
			return nil, err
		}
		keys = append(keys, k)
		if t != nil {
			keys = append(keys, *t)
		}
	}
	return keys, rows.Err()
}
