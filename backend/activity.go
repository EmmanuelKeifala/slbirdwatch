package main

import (
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
)

// COM-01 activity feed: recent verified sightings near a point or by people you follow.

// PUT / DELETE /users/{id}/follow — not across a block (either way).
func (a *server) follow(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUser(w, r)
	if !ok {
		return
	}
	if r.Method == http.MethodDelete {
		if _, err := a.db.Exec(r.Context(), `DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2`, userID(r), id); err != nil {
			internalError(w, "unfollow", err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	tag, err := a.db.Exec(r.Context(), `
		INSERT INTO follows (follower_id, followee_id)
		SELECT $1, u.id FROM users u WHERE u.id = $2 AND `+notBlocked("u.id")+`
		ON CONFLICT DO NOTHING`, userID(r), id)
	if err != nil {
		internalError(w, "follow", err)
		return
	}
	if tag.RowsAffected() == 0 {
		var exists bool
		a.db.QueryRow(r.Context(), `SELECT EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2)`, userID(r), id).Scan(&exists)
		if !exists {
			http.NotFound(w, r)
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

type followed struct {
	ID          int64   `json:"id"`
	DisplayName string  `json:"display_name"`
	AvatarURL   *string `json:"avatar_url"`
}

// GET /me/following — people I follow, newest first.
func (a *server) myFollowing(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.Query(r.Context(), `
		SELECT u.id, u.display_name, u.avatar_key FROM follows f JOIN users u ON u.id = f.followee_id
		WHERE f.follower_id = $1 ORDER BY f.created_at DESC`, userID(r))
	if err != nil {
		internalError(w, "following", err)
		return
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (followed, error) {
		var f followed
		var key *string
		err := row.Scan(&f.ID, &f.DisplayName, &key)
		if key != nil {
			u := a.media.url(*key)
			f.AvatarURL = &u
		}
		return f, err
	})
	if err != nil {
		internalError(w, "following", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// GET /activity?scope=near&lat=&lng=&km= (1–100, default 25) | scope=following — verified sightings, newest first,
// not your own, hidden or blocked ones. Near leaves out sightings whose location is blurred (sensitive species,
// observers hiding locations), so the filter can't give their real spot away.
func (a *server) activity(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	where := []string{"o.status = 'verified'", "NOT o.hidden", "o.user_id <> $1", notBlocked("o.user_id")}
	var args []any
	switch q.Get("scope") {
	case "following":
		if viewerID(r) == 0 {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "sign in to see people you follow"})
			return
		}
		where = append(where, "o.user_id IN (SELECT followee_id FROM follows WHERE follower_id = $1)")
	case "near":
		lat, err1 := strconv.ParseFloat(q.Get("lat"), 64)
		lng, err2 := strconv.ParseFloat(q.Get("lng"), 64)
		if err1 != nil || err2 != nil || lat < -90 || lat > 90 || lng < -180 || lng > 180 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "near needs lat and lng"})
			return
		}
		km, err := strconv.Atoi(q.Get("km"))
		if err != nil {
			km = 25
		}
		args = append(args, lng, lat, min(max(km, 1), 100)*1000)
		where = append(where, "NOT coalesce(cs.sensitive, false)", "NOT coalesce(s.sensitive, false)", "NOT u.hide_locations",
			"ST_DWithin(o.location, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4)")
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "scope is near or following"})
		return
	}
	a.listObservations(w, r, where, args, true)
}
