package api

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// COM-03 groups and clubs: members join with a 6-character code; only members see a group, its members, their
// outings and verified sightings, and its challenges (GAM-07). A group quiz uses the birds members have seen.

type group struct {
	ID          int64     `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Kind        string    `json:"kind"`
	JoinCode    string    `json:"join_code"`
	OwnerID     int64     `json:"owner_id"`
	Members     int       `json:"members"`
	CreatedAt   time.Time `json:"created_at"`
}

const groupColumns = `g.id, g.name, g.description, g.kind, g.join_code, g.owner_id,
	(SELECT count(*)::int FROM group_members m WHERE m.group_id = g.id), g.created_at`

func scanGroup(row pgx.CollectableRow) (group, error) {
	var g group
	err := row.Scan(&g.ID, &g.Name, &g.Description, &g.Kind, &g.JoinCode, &g.OwnerID, &g.Members, &g.CreatedAt)
	return g, err
}

// newJoinCode: 6 letters and digits without look-alikes (no 0/O, 1/I).
func newJoinCode() string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	b := make([]byte, 6)
	rand.Read(b)
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b)
}

// memberOf reports whether the user is in the group.
func memberOf(ctx context.Context, q querier, groupID, userID int64) (bool, error) {
	var ok bool
	err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2)`, groupID, userID).Scan(&ok)
	return ok, err
}

// groupFromPath loads a group the caller belongs to (404 otherwise, so outsiders can't tell it exists).
func (a *Server) groupFromPath(w http.ResponseWriter, r *http.Request) (group, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return group{}, false
	}
	rows, err := a.db.Query(r.Context(), `SELECT `+groupColumns+` FROM groups g
		JOIN group_members m ON m.group_id = g.id AND m.user_id = $2 WHERE g.id = $1`, id, userID(r))
	if err == nil {
		var g group
		if g, err = pgx.CollectExactlyOneRow(rows, scanGroup); err == nil {
			return g, true
		}
	}
	if errors.Is(err, pgx.ErrNoRows) {
		http.NotFound(w, r)
	} else {
		internalError(w, "group", err)
	}
	return group{}, false
}

// POST /groups {name, description, kind}
func (a *Server) createGroup(w http.ResponseWriter, r *http.Request) {
	var body group
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	body.Name, body.Description = strings.TrimSpace(body.Name), strings.TrimSpace(body.Description)
	if body.Kind == "" {
		body.Kind = "club"
	}
	if n := len([]rune(body.Name)); n < 2 || n > 60 || len([]rune(body.Description)) > 300 || (body.Kind != "club" && body.Kind != "school" && body.Kind != "friends") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a name of 2–60 characters, description up to 300, kind club, school or friends"})
		return
	}
	var owned int
	a.db.QueryRow(r.Context(), `SELECT count(*) FROM groups WHERE owner_id = $1`, userID(r)).Scan(&owned)
	if owned >= 10 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "you can run up to 10 groups"})
		return
	}
	var id int64
	err := pgx.BeginFunc(r.Context(), a.db, func(tx pgx.Tx) error {
		for try := 0; ; try++ { // a code clash is rare; try a fresh one
			err := tx.QueryRow(r.Context(), `INSERT INTO groups (name, description, kind, join_code, owner_id) VALUES ($1, $2, $3, $4, $5)
				ON CONFLICT (join_code) DO NOTHING RETURNING id`, body.Name, body.Description, body.Kind, newJoinCode(), userID(r)).Scan(&id)
			if err == nil {
				break
			}
			if !errors.Is(err, pgx.ErrNoRows) || try > 5 {
				return err
			}
		}
		_, err := tx.Exec(r.Context(), `INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)`, id, userID(r))
		return err
	})
	if err != nil {
		internalError(w, "create group", err)
		return
	}
	r.SetPathValue("id", strconv.FormatInt(id, 10))
	g, ok := a.groupFromPath(w, r)
	if ok {
		writeJSON(w, http.StatusCreated, g)
	}
}

// GET /me/groups
func (a *Server) myGroups(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.Query(r.Context(), `SELECT `+groupColumns+` FROM groups g JOIN group_members m ON m.group_id = g.id
		WHERE m.user_id = $1 ORDER BY g.name`, userID(r))
	if err != nil {
		internalError(w, "my groups", err)
		return
	}
	items, err := pgx.CollectRows(rows, scanGroup)
	if err != nil {
		internalError(w, "my groups", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// POST /groups/join {code}
func (a *Server) joinGroup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	if a.rateLimited(r.Context(), "join:"+strconv.FormatInt(userID(r), 10), 20, time.Hour) { // no guessing codes
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "too many tries, wait a while"})
		return
	}
	var id int64
	err := a.db.QueryRow(r.Context(), `INSERT INTO group_members (group_id, user_id)
		SELECT id, $2 FROM groups WHERE join_code = upper(trim($1))
		ON CONFLICT (group_id, user_id) DO UPDATE SET joined_at = group_members.joined_at RETURNING group_id`, body.Code, userID(r)).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no group has that code"})
		return
	}
	if err != nil {
		internalError(w, "join group", err)
		return
	}
	r.SetPathValue("id", strconv.FormatInt(id, 10))
	if g, ok := a.groupFromPath(w, r); ok {
		writeJSON(w, http.StatusOK, g)
	}
}

// DELETE /groups/{id}/members/{user} — leave (yourself) or remove someone (the owner). The owner can't leave;
// they delete the group instead.
func (a *Server) removeMember(w http.ResponseWriter, r *http.Request) {
	g, ok := a.groupFromPath(w, r)
	if !ok {
		return
	}
	who := userID(r)
	if v := r.PathValue("user"); v != "me" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		who = n
	}
	if who != userID(r) && g.OwnerID != userID(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "only the group's owner can remove people"})
		return
	}
	if who == g.OwnerID {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "the owner can't leave; delete the group instead"})
		return
	}
	if _, err := a.db.Exec(r.Context(), `DELETE FROM group_members WHERE group_id = $1 AND user_id = $2`, g.ID, who); err != nil {
		internalError(w, "remove member", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DELETE /groups/{id} (owner) · POST /groups/{id}/code (owner): a new join code, the old one stops working.
func (a *Server) ownGroup(w http.ResponseWriter, r *http.Request) {
	g, ok := a.groupFromPath(w, r)
	if !ok {
		return
	}
	if g.OwnerID != userID(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "only the group's owner can do that"})
		return
	}
	if r.Method == http.MethodDelete {
		if _, err := a.db.Exec(r.Context(), `DELETE FROM groups WHERE id = $1`, g.ID); err != nil {
			internalError(w, "delete group", err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	var code string
	for try := 0; try < 6; try++ {
		code = newJoinCode()
		_, err := a.db.Exec(r.Context(), `UPDATE groups SET join_code = $2 WHERE id = $1`, g.ID, code)
		var pgErr *pgconn.PgError
		if err == nil {
			break
		}
		if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
			internalError(w, "new code", err)
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"join_code": code})
}

type groupMember struct {
	observer
	Species int  `json:"species"` // life list (verified)
	WeekXP  int  `json:"week_xp"` // GAM-07: this week, the group's private board
	Owner   bool `json:"owner"`
}

type groupOuting struct {
	ID        int64     `json:"id"`
	User      observer  `json:"user"`
	StartedAt time.Time `json:"started_at"`
	DistanceM int       `json:"distance_m"`
	Species   int       `json:"species"`
}

// GET /groups/{id} — the group, its members ranked by XP this week (as GAM-05 counts it) (the private board: every member, private
// profiles and leaderboard opt-outs too, since only members see it), recent outings and challenges.
func (a *Server) getGroup(w http.ResponseWriter, r *http.Request) {
	g, ok := a.groupFromPath(w, r)
	if !ok {
		return
	}
	wk := week(time.Now())
	rows, err := a.db.Query(r.Context(), `
		WITH m AS (SELECT user_id FROM group_members WHERE group_id = $1),
		     s AS (SELECT user_id, created_at::date AS d, count(*) AS n FROM observations
		           WHERE user_id IN (SELECT user_id FROM m) AND status = 'verified' AND NOT hidden AND created_at >= $2 GROUP BY 1, 2),
		     i AS (SELECT i.user_id, i.created_at::date AS d, count(*) AS n FROM identifications i JOIN observations o ON o.id = i.observation_id
		           WHERE i.user_id IN (SELECT user_id FROM m) AND i.is_current AND i.created_at >= $2 AND o.status = 'verified'
		             AND NOT o.hidden AND o.user_id <> i.user_id AND i.species_id = o.community_species_id GROUP BY 1, 2),
		     l AS (SELECT user_id, count(*) AS n FROM (
		             SELECT user_id, community_species_id, min(created_at) AS first FROM observations
		             WHERE user_id IN (SELECT user_id FROM m) AND status = 'verified' AND NOT hidden GROUP BY 1, 2) f
		           WHERE first >= $2 GROUP BY 1),
		     x AS (SELECT user_id, sum(least(n, 10)) * 10 AS xp FROM s GROUP BY 1
		           UNION ALL SELECT user_id, n * 25 FROM l
		           UNION ALL SELECT user_id, sum(least(n, 20)) * 5 FROM i GROUP BY 1
		           UNION ALL SELECT user_id, sum(least(correct, 50)) FROM quiz_days WHERE day >= $2 AND user_id IN (SELECT user_id FROM m) GROUP BY 1)
		SELECT u.id, u.display_name, u.avatar_key,
		       (SELECT count(DISTINCT community_species_id)::int FROM observations WHERE user_id = u.id AND status = 'verified' AND NOT hidden),
		       coalesce((SELECT sum(xp)::int FROM x WHERE x.user_id = u.id), 0), u.id = $3
		FROM m JOIN users u ON u.id = m.user_id ORDER BY 5 DESC, u.display_name`, g.ID, wk, g.OwnerID)
	if err != nil {
		internalError(w, "group members", err)
		return
	}
	members, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (groupMember, error) {
		var m groupMember
		var avatar *string
		err := row.Scan(&m.ID, &m.DisplayName, &avatar, &m.Species, &m.WeekXP, &m.Owner)
		if avatar != nil {
			u := a.media.URL(*avatar)
			m.AvatarURL = &u
		}
		return m, err
	})
	if err != nil {
		internalError(w, "group members", err)
		return
	}
	rows, err = a.db.Query(r.Context(), `
		SELECT o.id, u.id, u.display_name, u.avatar_key, o.started_at, coalesce(ST_Length(o.route), 0)::int,
		       (SELECT count(DISTINCT coalesce(ob.community_species_id, ob.species_id))::int FROM observations ob WHERE ob.outing_id = o.id AND NOT ob.hidden)
		FROM outings o JOIN group_members m ON m.user_id = o.user_id AND m.group_id = $1 JOIN users u ON u.id = o.user_id
		WHERE o.started_at > now() - interval '60 days' ORDER BY o.started_at DESC LIMIT 30`, g.ID)
	if err != nil {
		internalError(w, "group outings", err)
		return
	}
	outings, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (groupOuting, error) {
		var o groupOuting
		var avatar *string
		err := row.Scan(&o.ID, &o.User.ID, &o.User.DisplayName, &avatar, &o.StartedAt, &o.DistanceM, &o.Species)
		if avatar != nil {
			u := a.media.URL(*avatar)
			o.User.AvatarURL = &u
		}
		return o, err
	})
	if err != nil {
		internalError(w, "group outings", err)
		return
	}
	challenges, err := a.groupChallenges(r.Context(), g.ID)
	if err != nil {
		internalError(w, "group challenges", err)
		return
	}
	if outings == nil {
		outings = []groupOuting{}
	}
	if challenges == nil {
		challenges = []groupChallenge{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"group": g, "members": members, "outings": outings, "challenges": challenges, "week_ends": wk.AddDate(0, 0, 7)})
}

// GET /groups/{id}/sightings — members' verified sightings, newest first (paged like the feed).
func (a *Server) groupSightings(w http.ResponseWriter, r *http.Request) {
	g, ok := a.groupFromPath(w, r)
	if !ok {
		return
	}
	a.listObservations(w, r, []string{"o.status = 'verified'", "NOT o.hidden", notBlocked("o.user_id"),
		"o.user_id IN (SELECT user_id FROM group_members WHERE group_id = $2)"}, []any{g.ID}, true)
}

type groupChallenge struct {
	ID       int64     `json:"id"`
	Title    string    `json:"title"`
	Goal     int       `json:"goal"`
	StartsAt time.Time `json:"starts_at"`
	EndsAt   time.Time `json:"ends_at"`
	Species  int       `json:"species"` // between the members so far (agreed IDs, observed in the window)
}

// groupChallenges: the group's challenges (running first), with progress.
func (a *Server) groupChallenges(ctx context.Context, groupID int64) ([]groupChallenge, error) {
	rows, err := a.db.Query(ctx, `
		SELECT c.id, c.title, c.goal, c.starts_at, c.ends_at,
		       (SELECT count(DISTINCT o.community_species_id)::int FROM observations o
		        WHERE o.user_id IN (SELECT user_id FROM group_members WHERE group_id = c.group_id)
		          AND o.status IN ('community', 'verified') AND NOT o.hidden AND o.observed_at >= c.starts_at AND o.observed_at < c.ends_at)
		FROM group_challenges c WHERE c.group_id = $1 AND c.ends_at > now() - interval '30 days'
		ORDER BY (c.ends_at < now()), c.ends_at LIMIT 10`, groupID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[groupChallenge])
}

// POST /groups/{id}/challenges {title, goal, starts_at, ends_at} (owner) · DELETE /groups/{id}/challenges/{cid} (owner)
func (a *Server) groupChallengeWrite(w http.ResponseWriter, r *http.Request) {
	g, ok := a.groupFromPath(w, r)
	if !ok {
		return
	}
	if g.OwnerID != userID(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "only the group's owner can set challenges"})
		return
	}
	if r.Method == http.MethodDelete {
		cid, _ := strconv.ParseInt(r.PathValue("cid"), 10, 64)
		if _, err := a.db.Exec(r.Context(), `DELETE FROM group_challenges WHERE id = $1 AND group_id = $2`, cid, g.ID); err != nil {
			internalError(w, "delete group challenge", err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	var c groupChallenge
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&c); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	c.Title = strings.TrimSpace(c.Title)
	if n := len([]rune(c.Title)); n < 2 || n > 60 || c.Goal < 1 || c.Goal > 1000 || !c.EndsAt.After(c.StartsAt) || c.EndsAt.Sub(c.StartsAt) > 366*24*time.Hour {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a title of 2–60 characters, a goal of 1–1000 species, and an end after the start (at most a year)"})
		return
	}
	if err := a.db.QueryRow(r.Context(), `INSERT INTO group_challenges (group_id, title, goal, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
		g.ID, c.Title, c.Goal, c.StartsAt, c.EndsAt).Scan(&c.ID); err != nil {
		internalError(w, "group challenge", err)
		return
	}
	writeJSON(w, http.StatusCreated, c)
}
