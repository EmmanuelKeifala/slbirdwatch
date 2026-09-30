package api

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5"
)

// COM-04 / NTF-03: when a sighting of a notable bird turns Verified, people who opted in and whose alert area
// covers it get a notification (and a push, from the reminders loop). Notable = rare in Sierra Leone (fewer than
// rareRecords GBIF records, or none) or flagged unusual (VER-08). Sensitive species never alert, and the alert
// names no place: only "within your alert area", so it reveals nothing the sighting page doesn't.

// notifyRare runs inside recompute when a sighting has just become verified.
func notifyRare(ctx context.Context, q querier, observationID, speciesID int64) error {
	_, err := q.Exec(ctx, `
		INSERT INTO notifications (user_id, kind, observation_id, species_id)
		SELECT u.id, 'rare', o.id, s.id
		FROM observations o JOIN species s ON s.id = $2
		LEFT JOIN region_species rs ON rs.species_id = s.id
		JOIN users u ON u.rare_alerts AND u.alert_lat IS NOT NULL AND u.id <> o.user_id
		WHERE o.id = $1 AND NOT o.hidden AND NOT s.sensitive
		  AND (o.unusual <> '' OR coalesce(rs.records, 0) < $3)
		  AND ST_DWithin(o.location, ST_SetSRID(ST_MakePoint(u.alert_lng, u.alert_lat), 4326)::geography, u.alert_km * 1000)
		  AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = u.id AND b.blocked_id = o.user_id)
		                  OR (b.blocker_id = o.user_id AND b.blocked_id = u.id))`, observationID, speciesID, rareRecords)
	return err
}

// flushRarePushes pushes rare-bird notifications that haven't gone out yet (called from the reminders loop).
func (a *Server) flushRarePushes(ctx context.Context) error {
	rows, err := a.db.Query(ctx, `SELECT DISTINCT user_id FROM notifications WHERE kind = 'rare' AND pushed_at IS NULL
		AND created_at > now() - interval '1 hour'`)
	if err != nil {
		return err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[int64])
	if err != nil {
		return err
	}
	for _, id := range ids {
		if err := a.sendPushes(ctx, id); err != nil {
			return err
		}
	}
	return nil
}

type alertSettings struct {
	On  bool     `json:"on"`
	Lat *float64 `json:"lat"`
	Lng *float64 `json:"lng"`
	Km  int      `json:"km"`
}

// GET / PUT /me/rare-alerts {on, lat, lng, km (5–100)} — switching on needs a spot.
func (a *Server) rareAlerts(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPut {
		var s alertSettings
		if !readJSON(w, r, 1024, &s) {
			return
		}
		if s.Km < 5 || s.Km > 100 || (s.On && (s.Lat == nil || s.Lng == nil)) ||
			(s.Lat != nil && (*s.Lat < -90 || *s.Lat > 90)) || (s.Lng != nil && (*s.Lng < -180 || *s.Lng > 180)) {
			writeError(w, http.StatusBadRequest, "a radius of 5–100 km, and a place when switching on")
			return
		}
		if _, err := a.db.Exec(r.Context(), `UPDATE users SET rare_alerts = $2, alert_lat = coalesce($3, alert_lat),
			alert_lng = coalesce($4, alert_lng), alert_km = $5 WHERE id = $1`, userID(r), s.On, s.Lat, s.Lng, s.Km); err != nil {
			internalError(w, "rare alerts", err)
			return
		}
	}
	var s alertSettings
	if err := a.db.QueryRow(r.Context(), `SELECT rare_alerts, alert_lat, alert_lng, alert_km FROM users WHERE id = $1`, userID(r)).
		Scan(&s.On, &s.Lat, &s.Lng, &s.Km); err != nil {
		internalError(w, "rare alerts", err)
		return
	}
	writeJSON(w, http.StatusOK, s)
}
