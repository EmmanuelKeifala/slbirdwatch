package api

import (
	"context"
)

// GAM-02 XP, with GAM-08's anti-gaming rules built in: XP is worked out from what happened, never stored, so
// it can't drift. Uploads count only once verified, IDs only when confirmed on someone else's sighting, and
// each kind is capped per day (uploads by the day they were posted, IDs by the day they were made).
// ponytail: recomputed per request from a few indexed counts; cache it if profiles get hot.

type xpRule struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	Points int    `json:"points"`
	PerDay int    `json:"per_day"` // 0 = no daily cap
}

var xpRules = []xpRule{
	{"sightings", "Verified sighting", 10, 10},
	{"lifers", "New bird on your life list (verified)", 25, 0},
	{"ids", "Your ID confirmed on someone else's sighting", 5, 20},
	{"quiz", "Correct quiz answer", 1, 50},
	{"challenges", "Weekly challenge completed", challengeXP, 0}, // GAM-01; three a week at most
}

// Levels: XP needed for each, and its name.
var xpLevels = []struct {
	At   int
	Name string
}{{0, "Fledgling"}, {100, "Spotter"}, {300, "Birder"}, {700, "Keen birder"}, {1500, "Field naturalist"}, {3000, "Expert"}, {6000, "Master birder"}}

type xpSummary struct {
	XP        int            `json:"xp"`
	Level     int            `json:"level"` // 1-based
	LevelName string         `json:"level_name"`
	LevelAt   int            `json:"level_at"` // XP where this level starts
	NextAt    *int           `json:"next_at"`  // XP for the next level; nil at the top
	Counts    map[string]int `json:"counts"`   // capped counts per rule key
	Today     map[string]int `json:"today"`    // today's uncapped counts, to show how much of each cap is used
	Rules     []xpRule       `json:"rules"`
}

func loadXP(ctx context.Context, q querier, userID int64) (xpSummary, error) {
	s := xpSummary{Counts: map[string]int{}, Today: map[string]int{}, Rules: xpRules}
	var sightings, lifers, ids, quiz, tS, tI, tQ int
	err := q.QueryRow(ctx, `
		WITH s AS (SELECT created_at::date AS d, count(*) AS n FROM observations
		           WHERE user_id = $1 AND status = 'verified' AND NOT hidden GROUP BY 1),
		     i AS (SELECT i.created_at::date AS d, count(*) AS n FROM identifications i JOIN observations o ON o.id = i.observation_id
		           WHERE i.user_id = $1 AND i.is_current AND o.status = 'verified' AND NOT o.hidden AND o.user_id <> $1
		             AND i.species_id = o.community_species_id GROUP BY 1)
		SELECT (SELECT coalesce(sum(least(n, $2)), 0)::int FROM s),
		       (SELECT count(DISTINCT community_species_id)::int FROM observations WHERE user_id = $1 AND status = 'verified' AND NOT hidden),
		       (SELECT coalesce(sum(least(n, $3)), 0)::int FROM i),
		       (SELECT coalesce(sum(least(correct, $4)), 0)::int FROM quiz_days WHERE user_id = $1),
		       coalesce((SELECT n::int FROM s WHERE d = current_date), 0),
		       coalesce((SELECT n::int FROM i WHERE d = current_date), 0),
		       coalesce((SELECT correct FROM quiz_days WHERE user_id = $1 AND day = current_date), 0)`,
		userID, xpRules[0].PerDay, xpRules[2].PerDay, xpRules[3].PerDay).Scan(&sightings, &lifers, &ids, &quiz, &tS, &tI, &tQ)
	if err != nil {
		return s, err
	}
	done, err := completedChallenges(ctx, q, userID)
	if err != nil {
		return s, err
	}
	s.Counts = map[string]int{"sightings": sightings, "lifers": lifers, "ids": ids, "quiz": quiz, "challenges": done}
	s.Today = map[string]int{"sightings": tS, "ids": tI, "quiz": tQ}
	for _, r := range xpRules {
		s.XP += r.Points * s.Counts[r.Key]
	}
	for i, l := range xpLevels {
		if s.XP >= l.At {
			s.Level, s.LevelName, s.LevelAt, s.NextAt = i+1, l.Name, l.At, nil
			if i+1 < len(xpLevels) {
				s.NextAt = new(xpLevels[i+1].At)
			}
		}
	}
	return s, nil
}
