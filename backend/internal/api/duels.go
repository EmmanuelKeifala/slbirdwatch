package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// QZ-11 head-to-head: one person makes a challenge (a fixed set of 10 questions under a 6-character code), plays
// it, and shares the code; friends play exactly the same set. Each person scores once; most right wins, then the
// faster. The server keeps the answers and marks the picks, so a score can't be made up.

type duelScore struct {
	User  observer `json:"user"`
	Right int      `json:"right"`
	Of    int      `json:"of"`
	TimeS float64  `json:"time_s"`
	Me    bool     `json:"me"`
}

type duel struct {
	Code      string         `json:"code"`
	Kind      string         `json:"kind"`
	Creator   observer       `json:"creator"`
	Questions []quizQuestion `json:"questions"`
	Scores    []duelScore    `json:"scores"` // best first
	Played    bool           `json:"played"` // by the viewer
	ExpiresAt time.Time      `json:"expires_at"`
}

// POST /duels {kind: picture|sound}
func (a *Server) createDuel(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Kind string `json:"kind"`
	}
	json.NewDecoder(http.MaxBytesReader(w, r.Body, 256)).Decode(&body)
	pool := photoPool
	switch body.Kind {
	case "", "picture":
		body.Kind = "picture"
	case "sound":
		pool = soundPool
	default:
		writeError(w, http.StatusBadRequest, "kind is picture or sound")
		return
	}
	if a.rateLimited(r.Context(), "duel:"+strconv.FormatInt(userID(r), 10), 20, time.Hour) {
		writeError(w, http.StatusTooManyRequests, "too many challenges, try again later")
		return
	}
	q := r.URL.Query() // a plain mixed quiz of 10 for the creator (their weak birds first, QZ-14)
	q.Set("n", "10")
	r.URL.RawQuery = q.Encode()
	questions, e := a.buildQuiz(r, body.Kind, pool)
	if e != nil {
		e.write(w)
		return
	}
	if len(questions) < 4 {
		writeError(w, http.StatusConflict, "not enough quiz media yet")
		return
	}
	raw, _ := json.Marshal(questions)
	var code string
	for try := 0; try < 6; try++ {
		code = newJoinCode()
		_, err := a.db.Exec(r.Context(), `INSERT INTO duels (code, creator_id, kind, questions) VALUES ($1, $2, $3, $4)`, code, userID(r), body.Kind, raw)
		var pgErr *pgconn.PgError
		if err == nil {
			break
		}
		if !errors.As(err, &pgErr) || pgErr.Code != "23505" || try == 5 {
			internalError(w, "create duel", err)
			return
		}
	}
	r.SetPathValue("code", code)
	a.getDuel(w, r)
}

// GET /duels/{code}
func (a *Server) getDuel(w http.ResponseWriter, r *http.Request) {
	var d duel
	var id int64
	var raw []byte
	var avatar *string
	err := a.db.QueryRow(r.Context(), `SELECT d.id, d.code, d.kind, d.questions, d.expires_at, u.id, u.display_name, u.avatar_key
		FROM duels d JOIN users u ON u.id = d.creator_id WHERE d.code = upper($1)`, strings.TrimSpace(r.PathValue("code"))).
		Scan(&id, &d.Code, &d.Kind, &raw, &d.ExpiresAt, &d.Creator.ID, &d.Creator.DisplayName, &avatar)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "no challenge has that code")
		return
	}
	if err != nil {
		internalError(w, "duel", err)
		return
	}
	if avatar != nil {
		u := a.media.URL(*avatar)
		d.Creator.AvatarURL = &u
	}
	json.Unmarshal(raw, &d.Questions)
	rows, err := a.db.Query(r.Context(), `SELECT u.id, u.display_name, u.avatar_key, s.right_count, s.answered, s.time_ms
		FROM duel_scores s JOIN users u ON u.id = s.user_id WHERE s.duel_id = $1 ORDER BY s.right_count DESC, s.time_ms`, id)
	if err != nil {
		internalError(w, "duel scores", err)
		return
	}
	d.Scores, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (duelScore, error) {
		var s duelScore
		var av *string
		var ms int
		err := row.Scan(&s.User.ID, &s.User.DisplayName, &av, &s.Right, &s.Of, &ms)
		if av != nil {
			u := a.media.URL(*av)
			s.User.AvatarURL = &u
		}
		s.TimeS, s.Me = float64(ms)/1000, s.User.ID == userID(r)
		d.Played = d.Played || s.Me
		return s, err
	})
	if err != nil {
		internalError(w, "duel scores", err)
		return
	}
	if d.Scores == nil {
		d.Scores = []duelScore{}
	}
	writeJSON(w, http.StatusOK, d)
}

// POST /duels/{code}/score {picks: [species id per question, 0 = skipped], time_ms} — once per person, while it's open.
func (a *Server) scoreDuel(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Picks  []int64 `json:"picks"`
		TimeMS int     `json:"time_ms"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil || body.TimeMS < 0 || body.TimeMS > 3600_000 {
		writeError(w, http.StatusBadRequest, "invalid score")
		return
	}
	var id int64
	var raw []byte
	var expires time.Time
	err := a.db.QueryRow(r.Context(), `SELECT id, questions, expires_at FROM duels WHERE code = upper($1)`, r.PathValue("code")).Scan(&id, &raw, &expires)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "no challenge has that code")
		return
	}
	if err != nil {
		internalError(w, "score duel", err)
		return
	}
	if time.Now().After(expires) {
		writeError(w, http.StatusGone, "this challenge has closed")
		return
	}
	var questions []quizQuestion
	json.Unmarshal(raw, &questions)
	if len(body.Picks) != len(questions) {
		writeError(w, http.StatusBadRequest, "one pick per question")
		return
	}
	right := 0
	for i, q := range questions { // the server marks it
		if body.Picks[i] == q.Answer.ID {
			right++
		}
	}
	tag, err := a.db.Exec(r.Context(), `INSERT INTO duel_scores (duel_id, user_id, right_count, answered, time_ms) VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (duel_id, user_id) DO NOTHING`, id, userID(r), right, len(questions), body.TimeMS)
	if err != nil {
		internalError(w, "score duel", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusConflict, "you've already played this one")
		return
	}
	a.getDuel(w, r)
}

// GET /me/duels — challenges you made or played, newest first, with your score and the best.
func (a *Server) myDuels(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.Query(r.Context(), `
		SELECT d.code, d.kind, u.display_name, d.created_at, d.expires_at,
		       (SELECT count(*)::int FROM duel_scores s WHERE s.duel_id = d.id),
		       (SELECT right_count FROM duel_scores s WHERE s.duel_id = d.id AND s.user_id = $1)
		FROM duels d JOIN users u ON u.id = d.creator_id
		WHERE d.creator_id = $1 OR EXISTS (SELECT 1 FROM duel_scores s WHERE s.duel_id = d.id AND s.user_id = $1)
		ORDER BY d.created_at DESC LIMIT 30`, userID(r))
	if err != nil {
		internalError(w, "my duels", err)
		return
	}
	type row struct {
		Code      string    `json:"code"`
		Kind      string    `json:"kind"`
		Creator   string    `json:"creator"`
		CreatedAt time.Time `json:"created_at"`
		ExpiresAt time.Time `json:"expires_at"`
		Players   int       `json:"players"`
		Mine      *int      `json:"mine"`
	}
	items, err := pgx.CollectRows(rows, pgx.RowToStructByPos[row])
	if err != nil {
		internalError(w, "my duels", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}
