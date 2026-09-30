package api

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/slbirdwatch/backend/internal/config"
)

// vote is one current identification of an observation.
type vote struct {
	species  int64
	verifier bool // verifier-or-higher identifying someone else's observation
	at       time.Time
}

// VER-02 rule knobs: CONSENSUS_MIN_IDS (default 2) and CONSENSUS_SHARE (default 0.667).
var (
	consensusMinIDs = config.Int("CONSENSUS_MIN_IDS", 2)
	consensusShare  = config.Float("CONSENSUS_SHARE", 2.0/3)
)

// consensus implements VER-02:
//   - any verifier ID → "verified" as the latest verifier's species;
//   - else ≥ consensusMinIDs IDs with ≥ consensusShare agreeing → "community" as that species;
//   - else "needs_id".
func consensus(votes []vote) (status string, species *int64) {
	var latest *vote
	for i := range votes {
		if votes[i].verifier && (latest == nil || votes[i].at.After(latest.at)) {
			latest = &votes[i]
		}
	}
	if latest != nil {
		return "verified", &latest.species
	}
	counts := map[int64]int{}
	var top int64
	for _, v := range votes {
		counts[v.species]++
		if counts[v.species] > counts[top] {
			top = v.species
		}
	}
	// Small epsilon so the default 2/3 accepts exactly 2 of 3 despite float rounding.
	if len(votes) >= consensusMinIDs && float64(counts[top]) >= consensusShare*float64(len(votes))-1e-9 {
		return "community", &top
	}
	return "needs_id", nil
}

type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// recompute refreshes an observation's status and community species from its current votes.
// The observer's own species counts as a vote but never as a verification.
func recompute(ctx context.Context, q querier, observationID int64) error {
	rows, err := q.Query(ctx, `
		SELECT o.species_id, false, o.updated_at FROM observations o WHERE o.id = $1 AND o.species_id IS NOT NULL
		UNION ALL
		SELECT i.species_id, u.role >= 'verifier', i.created_at
		FROM identifications i JOIN users u ON u.id = i.user_id
		WHERE i.observation_id = $1 AND i.is_current`, observationID)
	if err != nil {
		return err
	}
	votes, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (vote, error) {
		var v vote
		return v, r.Scan(&v.species, &v.verifier, &v.at)
	})
	if err != nil {
		return err
	}
	var before string // COM-04: alert nearby birders when a rare bird has just been verified
	if err := q.QueryRow(ctx, `SELECT status FROM observations WHERE id = $1`, observationID).Scan(&before); err != nil {
		return err
	}
	status, species := consensus(votes)
	// VER-08: judge the species it would settle on (or the observer's own); if unlikely here and now,
	// community agreement isn't enough and it waits for a verifier.
	var lat, lng float64
	var at time.Time
	var own *int64
	if err := q.QueryRow(ctx, `SELECT ST_Y(location::geometry), ST_X(location::geometry), observed_at, species_id FROM observations WHERE id = $1`,
		observationID).Scan(&lat, &lng, &at, &own); err != nil {
		return err
	}
	unusual := ""
	if judge := coalesceID(species, own); judge != nil {
		if unusual, err = unusualFor(ctx, q, *judge, lat, lng, at); err != nil {
			return err
		}
	}
	if unusual != "" && status == "community" {
		status, species = "needs_id", nil
	}
	if _, err = q.Exec(ctx, `UPDATE observations SET status = $2, community_species_id = $3, unusual = $4 WHERE id = $1`,
		observationID, status, species, unusual); err != nil {
		return err
	}
	if status == "verified" && before != "verified" && species != nil {
		return notifyRare(ctx, q, observationID, *species)
	}
	return nil
}

func coalesceID(a, b *int64) *int64 {
	if a != nil {
		return a
	}
	return b
}

type identification struct {
	ID        int64      `json:"id"`
	User      observer   `json:"user"`
	Verifier  bool       `json:"verifier"`
	Species   speciesRef `json:"species"`
	Reason    string     `json:"reason"`
	CreatedAt time.Time  `json:"created_at"`
}

// POST /observations/{id}/identifications — VER-01. {species_id, reason}; replaces the caller's previous ID.
func (a *Server) addIdentification(w http.ResponseWriter, r *http.Request) {
	oid, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var body struct {
		SpeciesID int64  `json:"species_id"`
		Reason    string `json:"reason"`
	}
	if !readJSON(w, r, 4096, &body) {
		return
	}
	body.Reason = strings.TrimSpace(body.Reason)
	if len([]rune(body.Reason)) > 500 {
		writeError(w, http.StatusBadRequest, "reason must be at most 500 characters")
		return
	}
	if a.rateLimited(r.Context(), "id:"+strconv.FormatInt(userID(r), 10), 300, time.Hour) {
		writeError(w, http.StatusTooManyRequests, "too many identifications, try again later")
		return
	}
	var owner int64
	var extinct bool
	err := a.db.QueryRow(r.Context(), `
		SELECT o.user_id, coalesce((SELECT extinct OR merged_into IS NOT NULL FROM species WHERE id = $2), true)
		FROM observations o WHERE o.id = $1`, oid, body.SpeciesID).Scan(&owner, &extinct)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		http.NotFound(w, r)
		return
	case err != nil:
		internalError(w, "identify", err)
		return
	case owner == userID(r):
		writeError(w, http.StatusBadRequest, "edit your own sighting to change its species")
		return
	case a.blockedBetween(r, owner):
		writeError(w, http.StatusForbidden, "you can't identify this sighting")
		return
	case extinct:
		writeError(w, http.StatusBadRequest, "unknown species")
		return
	}
	err = pgx.BeginFunc(r.Context(), a.db, func(tx pgx.Tx) error {
		var before string
		if err := tx.QueryRow(r.Context(), `SELECT status FROM observations WHERE id = $1 FOR UPDATE`, oid).Scan(&before); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `UPDATE identifications SET is_current = false
			WHERE observation_id = $1 AND user_id = $2 AND is_current`, oid, userID(r)); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `INSERT INTO identifications (observation_id, user_id, species_id, reason)
			VALUES ($1, $2, $3, $4)`, oid, userID(r), body.SpeciesID, body.Reason); err != nil {
			return err
		}
		if err := recompute(r.Context(), tx, oid); err != nil {
			return err
		}
		if err := promoteTrusted(r.Context(), tx, oid); err != nil { // VER-06
			return err
		}
		return notifyIdentification(r.Context(), tx, oid, owner, userID(r), body.SpeciesID, before)
	})
	if err != nil {
		internalError(w, "identify", err)
		return
	}
	go a.pushUser(owner) // NTF-01: after commit, off the request path
	a.respondObservation(w, r, oid, http.StatusCreated)
}

// DELETE /observations/{id}/identifications — withdraw the caller's current ID.
func (a *Server) withdrawIdentification(w http.ResponseWriter, r *http.Request) {
	oid, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var n int64
	err := pgx.BeginFunc(r.Context(), a.db, func(tx pgx.Tx) error {
		tag, err := tx.Exec(r.Context(), `UPDATE identifications SET is_current = false
			WHERE observation_id = $1 AND user_id = $2 AND is_current`, oid, userID(r))
		if err != nil {
			return err
		}
		if n = tag.RowsAffected(); n == 0 {
			return nil
		}
		return recompute(r.Context(), tx, oid)
	})
	if err != nil {
		internalError(w, "withdraw identification", err)
		return
	}
	if n == 0 {
		http.NotFound(w, r)
		return
	}
	a.respondObservation(w, r, oid, http.StatusOK)
}

// GET /observations/{id}/identifications — public list of current IDs, oldest first.
func (a *Server) listIdentifications(w http.ResponseWriter, r *http.Request) {
	viewer := viewerID(r)
	oid, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	rows, err := a.db.Query(r.Context(), `
		SELECT i.id, u.id, u.display_name, u.avatar_key, u.role >= 'verifier',
		       s.id, s.english_name, s.scientific_name, i.reason, i.created_at
		FROM identifications i
		JOIN users u ON u.id = i.user_id
		JOIN species s ON s.id = i.species_id
		WHERE i.observation_id = $2 AND i.is_current AND `+notBlocked("i.user_id")+`
		ORDER BY i.created_at`, viewer, oid)
	if err != nil {
		internalError(w, "list identifications", err)
		return
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (identification, error) {
		var i identification
		var avatar *string
		err := row.Scan(&i.ID, &i.User.ID, &i.User.DisplayName, &avatar, &i.Verifier,
			&i.Species.ID, &i.Species.EnglishName, &i.Species.ScientificName, &i.Reason, &i.CreatedAt)
		if avatar != nil {
			u := a.media.URL(*avatar)
			i.User.AvatarURL = &u
		}
		return i, err
	})
	if err != nil {
		internalError(w, "list identifications", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// respondObservation writes one observation as the caller may see it.
func (a *Server) respondObservation(w http.ResponseWriter, r *http.Request, id int64, code int) {
	o, err := a.scanObservation(a.db.QueryRow(r.Context(), observationSelect+` WHERE o.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	one := []observation{o}
	if err == nil {
		err = a.redact(r.Context(), one, viewerID(r))
	}
	if err == nil {
		err = a.withPhotos(r.Context(), one)
	}
	if err != nil {
		internalError(w, "load observation", err)
		return
	}
	writeJSON(w, code, one[0])
}

var flagReasons = []string{"wrong_id", "captive", "poor_quality", "inappropriate", "sensitive_location"}

// POST /observations/{id}/flags — VER-05. {reason, note}; reviewed in the moderation queue (ADM-01).
func (a *Server) flagObservation(w http.ResponseWriter, r *http.Request) {
	oid, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var body struct {
		Reason string `json:"reason"`
		Note   string `json:"note"`
	}
	if !readJSON(w, r, 4096, &body) {
		return
	}
	body.Note = strings.TrimSpace(body.Note)
	if !slices.Contains(flagReasons, body.Reason) || len([]rune(body.Note)) > 500 {
		writeError(w, http.StatusBadRequest, "reason must be one of wrong_id, captive, poor_quality, inappropriate, sensitive_location (note ≤ 500 chars)")
		return
	}
	if a.rateLimited(r.Context(), "flag:"+strconv.FormatInt(userID(r), 10), 50, time.Hour) {
		writeError(w, http.StatusTooManyRequests, "too many reports, try again later")
		return
	}
	var owner int64
	if err := a.db.QueryRow(r.Context(), `SELECT user_id FROM observations WHERE id = $1`, oid).Scan(&owner); errors.Is(err, pgx.ErrNoRows) {
		http.NotFound(w, r)
		return
	} else if err != nil {
		internalError(w, "flag", err)
		return
	}
	if owner == userID(r) {
		writeError(w, http.StatusBadRequest, "you can't report your own sighting")
		return
	}
	_, err := a.db.Exec(r.Context(), `INSERT INTO flags (observation_id, user_id, reason, note) VALUES ($1, $2, $3, $4)`,
		oid, userID(r), body.Reason, body.Note)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		writeError(w, http.StatusConflict, "you've already reported this")
		return
	}
	if err != nil {
		internalError(w, "flag", err)
		return
	}
	w.WriteHeader(http.StatusCreated)
}
