package main

import (
	"context"
	"fmt"
)

// VER-06 reputation: your IDs on other people's sightings that ended up Verified — confirmed when the verified
// species is the one you suggested, wrong otherwise. Enough confirmed IDs, accurately, make a member Trusted.

const (
	trustedMinConfirmed = 20
	trustedMinAccuracy  = 0.8
)

type reputation struct {
	Confirmed int `json:"confirmed"`
	Wrong     int `json:"wrong"`
	Accuracy  int `json:"accuracy"` // percent of verified outcomes you got right; 0 with none yet
}

func loadReputation(ctx context.Context, q querier, userID int64) (reputation, error) {
	var r reputation
	err := q.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE i.species_id = o.community_species_id),
		       count(*) FILTER (WHERE i.species_id <> o.community_species_id)
		FROM identifications i JOIN observations o ON o.id = i.observation_id
		WHERE i.user_id = $1 AND i.is_current AND o.status = 'verified' AND o.user_id <> $1`, userID).Scan(&r.Confirmed, &r.Wrong)
	if n := r.Confirmed + r.Wrong; n > 0 {
		r.Accuracy = 100 * r.Confirmed / n
	}
	return r, err
}

func (r reputation) earnsTrusted() bool {
	n := r.Confirmed + r.Wrong
	return r.Confirmed >= trustedMinConfirmed && n > 0 && float64(r.Confirmed)/float64(n) >= trustedMinAccuracy
}

// promoteTrusted runs after a sighting's consensus changes: once it's verified, every member who identified
// it and now meets the bar becomes Trusted (never demoted automatically; admins still set roles by hand).
func promoteTrusted(ctx context.Context, q querier, observationID int64) error {
	var verified bool
	if err := q.QueryRow(ctx, `SELECT status = 'verified' FROM observations WHERE id = $1`, observationID).Scan(&verified); err != nil || !verified {
		return err
	}
	rows, err := q.Query(ctx, `SELECT u.id FROM identifications i JOIN users u ON u.id = i.user_id
		WHERE i.observation_id = $1 AND i.is_current AND u.role = 'member'`, observationID)
	if err != nil {
		return err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	rows.Close()
	for _, id := range ids {
		r, err := loadReputation(ctx, q, id)
		if err != nil {
			return err
		}
		if !r.earnsTrusted() {
			continue
		}
		if _, err := q.Exec(ctx, `UPDATE users SET role = 'trusted' WHERE id = $1 AND role = 'member'`, id); err != nil {
			return err
		}
		if _, err := q.Exec(ctx, `INSERT INTO moderation_actions (moderator_id, target_type, target_id, action, note)
			VALUES (NULL, 'user', $1, 'role', $2)`, id, fmt.Sprintf("member → trusted (automatic: %d confirmed IDs, %d%% right)", r.Confirmed, r.Accuracy)); err != nil {
			return err
		}
	}
	return nil
}
