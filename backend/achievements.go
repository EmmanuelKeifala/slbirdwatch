package main

import (
	"context"
	"net/http"
	"time"
)

// GAM-03 badges and GAM-04 streaks, worked out from activity like XP (nothing stored, nothing to game).

type badge struct {
	Key         string `json:"key"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Icon        string `json:"icon"` // Feather icon name
	Progress    int    `json:"progress"`
	Goal        int    `json:"goal"`
	Earned      bool   `json:"earned"`
}

type streak struct {
	Current int `json:"current"`
	Best    int `json:"best"`
}

// rareRecords: a Sierra Leone bird with fewer GBIF records than this (or none) counts as rare for the badge.
const rareRecords = 20

// runs returns the current run (ending at `now` or the step before it) and the longest run of consecutive
// steps in sorted, distinct period starts.
func runs(periods []time.Time, now time.Time, step func(time.Time) time.Time) streak {
	var s streak
	run := 0
	for i, p := range periods {
		if i > 0 && step(periods[i-1]).Equal(p) {
			run++
		} else {
			run = 1
		}
		s.Best = max(s.Best, run)
	}
	if n := len(periods); n > 0 {
		last := periods[n-1]
		if last.Equal(now) || step(last).Equal(now) {
			s.Current = run
		}
	}
	return s
}

func day(t time.Time) time.Time {
	y, m, d := t.UTC().Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// week is the Monday starting t's week.
func week(t time.Time) time.Time {
	d := day(t)
	return d.AddDate(0, 0, -((int(d.Weekday()) + 6) % 7))
}

func (a *server) loadAchievements(ctx context.Context, uid int64, now time.Time) ([]badge, map[string]streak, error) {
	var posted, species, rare, ids, sounds, refs, correct, bestAnswers, outings int
	err := a.db.QueryRow(ctx, `
		WITH v AS (SELECT * FROM observations WHERE user_id = $1 AND status = 'verified' AND NOT hidden)
		SELECT (SELECT count(*)::int FROM observations WHERE user_id = $1),
		       (SELECT count(DISTINCT community_species_id)::int FROM v),
		       (SELECT count(DISTINCT v.community_species_id)::int FROM v LEFT JOIN region_species rs ON rs.species_id = v.community_species_id
		        WHERE coalesce(rs.records, 0) < $2),
		       (SELECT count(*)::int FROM identifications i JOIN observations o ON o.id = i.observation_id
		        WHERE i.user_id = $1 AND i.is_current AND o.status = 'verified' AND NOT o.hidden AND o.user_id <> $1
		          AND i.species_id = o.community_species_id),
		       (SELECT count(DISTINCT v.id)::int FROM v JOIN media m ON m.observation_id = v.id AND m.kind = 'sound'),
		       (SELECT count(*)::int FROM v JOIN media m ON m.observation_id = v.id AND m.reference),
		       coalesce((SELECT correct FROM quiz_stats WHERE user_id = $1), 0),
		       coalesce((SELECT best_streak FROM quiz_stats WHERE user_id = $1), 0),
		       (SELECT count(*)::int FROM outings WHERE user_id = $1)`, uid, rareRecords).
		Scan(&posted, &species, &rare, &ids, &sounds, &refs, &correct, &bestAnswers, &outings)
	if err != nil {
		return nil, nil, err
	}

	challengesDone, err := completedChallenges(ctx, a.db, uid)
	if err != nil {
		return nil, nil, err
	}
	var eventsJoined int // GAM-06
	if err := a.db.QueryRow(ctx, `SELECT count(*)::int FROM events e WHERE EXISTS (SELECT 1 FROM observations o WHERE o.user_id = $1
		AND o.status IN ('community', 'verified') AND NOT o.hidden AND o.observed_at >= e.starts_at AND o.observed_at < e.ends_at)`, uid).Scan(&eventsJoined); err != nil {
		return nil, nil, err
	}
	var quizDays, outingWeeks []time.Time
	rows, err := a.db.Query(ctx, `SELECT day FROM quiz_days WHERE user_id = $1 ORDER BY day`, uid)
	if err != nil {
		return nil, nil, err
	}
	for rows.Next() {
		var d time.Time
		if err := rows.Scan(&d); err != nil {
			rows.Close()
			return nil, nil, err
		}
		quizDays = append(quizDays, day(d))
	}
	rows.Close()
	rows, err = a.db.Query(ctx, `SELECT DISTINCT date_trunc('week', started_at AT TIME ZONE 'UTC') FROM outings WHERE user_id = $1 ORDER BY 1`, uid)
	if err != nil {
		return nil, nil, err
	}
	for rows.Next() {
		var w time.Time
		if err := rows.Scan(&w); err != nil {
			rows.Close()
			return nil, nil, err
		}
		outingWeeks = append(outingWeeks, week(w))
	}
	rows.Close()
	streaks := map[string]streak{
		"daily_quiz":    runs(quizDays, day(now), func(t time.Time) time.Time { return t.AddDate(0, 0, 1) }),
		"weekly_outing": runs(outingWeeks, week(now), func(t time.Time) time.Time { return t.AddDate(0, 0, 7) }),
	}

	b := func(key, name, desc, icon string, have, goal int) badge {
		return badge{key, name, desc, icon, min(have, goal), goal, have >= goal}
	}
	badges := []badge{
		b("first_sighting", "First sighting", "Post your first sighting", "camera", posted, 1),
		b("species_10", "Ten birds", "10 species on your life list, verified", "feather", species, 10),
		b("species_50", "Fifty birds", "50 species on your life list, verified", "feather", species, 50),
		b("species_100", "Century", "100 species on your life list, verified", "star", species, 100),
		b("rare_bird", "Rare find", "A verified sighting of a bird rarely recorded in Sierra Leone", "zap", rare, 1),
		b("ids_10", "Helping hand", "10 of your IDs confirmed on other people’s sightings", "users", ids, 10),
		b("ids_50", "Field expert", "50 of your IDs confirmed on other people’s sightings", "award", ids, 50),
		b("recordist", "Recordist", "A verified sighting with a sound recording", "mic", sounds, 1),
		b("reference", "Reference shot", "A verifier picked your photo as a reference", "image", refs, 1),
		b("quiz_100", "Quiz whiz", "100 correct quiz answers", "check-circle", correct, 100),
		b("quiz_run_10", "On a roll", "10 quiz answers right in a row", "trending-up", bestAnswers, 10),
		b("quiz_week", "Daily learner", "Quiz 7 days in a row", "calendar", streaks["daily_quiz"].Best, 7),
		b("outing_1", "Out in the field", "Log your first outing", "map", outings, 1),
		b("outing_month", "Regular", "Go out 4 weeks in a row", "repeat", streaks["weekly_outing"].Best, 4),
		b("challenger", "Challenger", "Complete a weekly challenge", "flag", challengesDone, 1),
		b("big_day", "Big Day birder", "Log an agreed sighting during a seasonal event", "sunrise", eventsJoined, 1),
		b("challenger_10", "Challenge champion", "Complete 10 weekly challenges", "target", challengesDone, 10),
	}
	return badges, streaks, nil
}

// GET /me/achievements — badges (in display order) and streaks.
func (a *server) myAchievements(w http.ResponseWriter, r *http.Request) {
	badges, streaks, err := a.loadAchievements(r.Context(), userID(r), time.Now())
	if err != nil {
		internalError(w, "achievements", err)
		return
	}
	earned := 0
	for _, b := range badges {
		if b.Earned {
			earned++
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"badges": badges, "earned": earned, "streaks": streaks})
}
