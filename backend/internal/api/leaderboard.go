package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

// GAM-05 leaderboards: XP earned this week (Monday–Sunday), with GAM-02's rules and daily caps. Challenge XP
// is left out here (it needs every challenge measured for every person). Scopes: everyone, or "near": people
// with a verified sighting within 50 km of a point this week. People who opted out, private profiles and
// blocked people are never listed.

type boardRow struct {
	Rank int      `json:"rank"`
	User observer `json:"user"`
	XP   int      `json:"xp"`
	Me   bool     `json:"me"`
}

// GET /leaderboard?scope=week|near&lat=&lng=
func (a *Server) leaderboard(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	wk := week(time.Now())
	var lat, lng *float64
	if q.Get("scope") == "near" {
		y, err1 := strconv.ParseFloat(q.Get("lat"), 64)
		x, err2 := strconv.ParseFloat(q.Get("lng"), 64)
		if err1 != nil || err2 != nil || y < -90 || y > 90 || x < -180 || x > 180 {
			writeError(w, http.StatusBadRequest, "near needs lat and lng")
			return
		}
		lat, lng = &y, &x
	}
	rows, err := a.db.Query(r.Context(), `
		WITH s AS (SELECT user_id, created_at::date AS d, count(*) AS n FROM observations
		           WHERE status = 'verified' AND NOT hidden AND created_at >= $2 GROUP BY 1, 2),
		     l AS (SELECT user_id, count(*) AS n FROM (
		             SELECT user_id, community_species_id, min(created_at) AS first FROM observations
		             WHERE status = 'verified' AND NOT hidden GROUP BY 1, 2) f WHERE first >= $2 GROUP BY 1),
		     i AS (SELECT i.user_id, i.created_at::date AS d, count(*) AS n FROM identifications i JOIN observations o ON o.id = i.observation_id
		           WHERE i.is_current AND i.created_at >= $2 AND o.status = 'verified' AND NOT o.hidden AND o.user_id <> i.user_id
		             AND i.species_id = o.community_species_id GROUP BY 1, 2),
		     x AS (SELECT user_id, sum(least(n, 10)) * 10 AS xp FROM s GROUP BY 1
		           UNION ALL SELECT user_id, n * 25 FROM l
		           UNION ALL SELECT user_id, sum(least(n, 20)) * 5 FROM i GROUP BY 1
		           UNION ALL SELECT user_id, sum(least(correct, 50)) FROM quiz_days WHERE day >= $2 GROUP BY 1),
		     t AS (SELECT user_id, sum(xp)::int AS xp FROM x GROUP BY 1 HAVING sum(xp) > 0)
		SELECT rank() OVER (ORDER BY t.xp DESC)::int, u.id, u.display_name, u.avatar_key, t.xp
		FROM t JOIN users u ON u.id = t.user_id
		WHERE NOT u.hide_from_leaderboards AND NOT u.private_profile AND `+notBlocked("u.id")+`
		  AND ($3::float8 IS NULL OR EXISTS (SELECT 1 FROM observations o WHERE o.user_id = u.id AND o.status = 'verified'
		       AND NOT o.hidden AND o.created_at >= $2 AND ST_DWithin(o.location, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography, 50000)))
		ORDER BY t.xp DESC, u.id LIMIT 50`, viewerID(r), wk, lat, lng)
	if err != nil {
		internalError(w, "leaderboard", err)
		return
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (boardRow, error) {
		var b boardRow
		var avatar *string
		err := row.Scan(&b.Rank, &b.User.ID, &b.User.DisplayName, &avatar, &b.XP)
		b.User.AvatarURL = a.mediaURL(avatar)
		b.Me = b.User.ID == viewerID(r)
		return b, err
	})
	if err != nil {
		internalError(w, "leaderboard", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "week": wk, "ends": wk.AddDate(0, 0, 7)})
}
