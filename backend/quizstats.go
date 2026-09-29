package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strconv"

	"github.com/jackc/pgx/v5"
)

// ACC-04: quiz progress follows the account. The app sends changes (one finished quiz, or a guest's whole
// on-phone progress when they sign in); the server adds them under a row lock, so two phones can't overwrite
// each other. Missed counts go down when a bird is later answered right (negative change) and vanish at 0.

type quizStats struct {
	Quizzes    int               `json:"quizzes"`
	Answered   int               `json:"answered"`
	Correct    int               `json:"correct"`
	BestStreak int               `json:"bestStreak"`
	Missed     map[string]int    `json:"missed"`
	BySpecies  map[string][2]int `json:"bySpecies"` // LRN-06: species id → [right, wrong]
	ByKind     map[string][2]int `json:"byKind"`    // picture | sound → [right, wrong]
}

const maxMissed = 300

// mergeQuizStats adds a change to stored progress; best streak is the larger of the two.
func mergeQuizStats(s, d quizStats) quizStats {
	out := quizStats{Quizzes: s.Quizzes + d.Quizzes, Answered: s.Answered + d.Answered, Correct: s.Correct + d.Correct,
		BestStreak: max(s.BestStreak, d.BestStreak), Missed: map[string]int{}, BySpecies: map[string][2]int{}, ByKind: map[string][2]int{}}
	addPairs(out.BySpecies, s.BySpecies, d.BySpecies, true)
	addPairs(out.ByKind, s.ByKind, d.ByKind, false)
	for k, v := range s.Missed {
		out.Missed[k] = v
	}
	for k, v := range d.Missed {
		if _, err := strconv.ParseInt(k, 10, 64); err != nil {
			continue
		}
		if out.Missed[k] += v; out.Missed[k] <= 0 {
			delete(out.Missed, k)
		}
	}
	if len(out.Missed) > maxMissed { // keep the most-missed birds
		keys := make([]string, 0, len(out.Missed))
		for k := range out.Missed {
			keys = append(keys, k)
		}
		sort.Slice(keys, func(i, j int) bool { return out.Missed[keys[i]] < out.Missed[keys[j]] })
		for _, k := range keys[:len(keys)-maxMissed] {
			delete(out.Missed, k)
		}
	}
	return out
}

// GET /me/quiz-stats
func (a *server) myQuizStats(w http.ResponseWriter, r *http.Request) {
	s := quizStats{Missed: map[string]int{}, BySpecies: map[string][2]int{}, ByKind: map[string][2]int{}}
	err := a.db.QueryRow(r.Context(), `SELECT quizzes, answered, correct, best_streak, missed, by_species, by_kind FROM quiz_stats WHERE user_id = $1`, userID(r)).
		Scan(&s.Quizzes, &s.Answered, &s.Correct, &s.BestStreak, &s.Missed, &s.BySpecies, &s.ByKind)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		internalError(w, "quiz stats", err)
		return
	}
	writeJSON(w, http.StatusOK, s)
}

// POST /me/quiz-stats {quizzes, answered, correct, bestStreak, missed} — adds a change, returns the total.
func (a *server) addQuizStats(w http.ResponseWriter, r *http.Request) {
	var d quizStats
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&d); err != nil ||
		d.Quizzes < 0 || d.Answered < 0 || d.Correct < 0 || d.Correct > d.Answered || d.BestStreak < 0 || d.BestStreak > d.Answered ||
		d.Quizzes > 10000 || d.Answered > 200000 || len(d.Missed) > 1000 || len(d.BySpecies) > 3000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid quiz stats"})
		return
	}
	var out quizStats
	err := pgx.BeginFunc(r.Context(), a.db, func(tx pgx.Tx) error {
		s := quizStats{Missed: map[string]int{}, BySpecies: map[string][2]int{}, ByKind: map[string][2]int{}}
		if _, err := tx.Exec(r.Context(), `INSERT INTO quiz_stats (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, userID(r)); err != nil {
			return err
		}
		if err := tx.QueryRow(r.Context(), `SELECT quizzes, answered, correct, best_streak, missed, by_species, by_kind FROM quiz_stats
			WHERE user_id = $1 FOR UPDATE`, userID(r)).Scan(&s.Quizzes, &s.Answered, &s.Correct, &s.BestStreak, &s.Missed, &s.BySpecies, &s.ByKind); err != nil {
			return err
		}
		out = mergeQuizStats(s, d)
		_, err := tx.Exec(r.Context(), `UPDATE quiz_stats SET quizzes = $2, answered = $3, correct = $4, best_streak = $5, missed = $6,
			by_species = $7, by_kind = $8, updated_at = now() WHERE user_id = $1`,
			userID(r), out.Quizzes, out.Answered, out.Correct, out.BestStreak, out.Missed, out.BySpecies, out.ByKind)
		if err != nil || (d.Correct == 0 && d.Quizzes == 0) { // a quiz day counts for GAM-04 streaks even with 0 right
			return err
		}
		_, err = tx.Exec(r.Context(), `INSERT INTO quiz_days (user_id, day, correct, quizzes, answered) VALUES ($1, current_date, $2, $3, $4)
			ON CONFLICT (user_id, day) DO UPDATE SET correct = quiz_days.correct + $2, quizzes = quiz_days.quizzes + $3,
			answered = quiz_days.answered + $4`, userID(r), d.Correct, d.Quizzes, d.Answered) // GAM-02: XP is capped per day
		return err
	})
	if err != nil {
		internalError(w, "add quiz stats", err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// addPairs sums [right, wrong] counts; species keys must be ids, kinds must be picture or sound.
func addPairs(out, a, b map[string][2]int, ids bool) {
	for _, m := range []map[string][2]int{a, b} {
		for k, v := range m {
			if ids {
				if _, err := strconv.ParseInt(k, 10, 64); err != nil {
					continue
				}
			} else if k != "picture" && k != "sound" {
				continue
			}
			if v[0] < 0 || v[1] < 0 {
				continue
			}
			p := out[k]
			out[k] = [2]int{p[0] + v[0], p[1] + v[1]}
		}
	}
}
