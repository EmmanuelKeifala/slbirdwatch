package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

var experienceLevels = []string{"beginner", "intermediate", "advanced", "expert"}

// licences mirrors the media_licence enum (011_licences.sql).
var licences = []string{"cc0", "cc-by", "cc-by-nc", "all-rights-reserved"}

// PATCH /me — ACC-05. Only fields present in the body change.
func (a *server) updateProfile(w http.ResponseWriter, r *http.Request) {
	var body struct {
		DisplayName     *string `json:"display_name"`
		HomeArea        *string `json:"home_area"`
		ExperienceLevel *string `json:"experience_level"`
		Bio             *string `json:"bio"`
		DefaultLicence  *string `json:"default_licence"`
		HideLocations   *bool   `json:"hide_locations"`
		PrivateProfile  *bool   `json:"private_profile"`
		NotifyIDs       *bool   `json:"notify_ids"`
		NotifyStatus    *bool   `json:"notify_status"`
		NotifyComments  *bool   `json:"notify_comments"`
		NotifyReminders *bool   `json:"notify_reminders"`
		HideFromBoards  *bool   `json:"hide_from_leaderboards"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	trim := func(p *string) {
		if p != nil {
			*p = strings.TrimSpace(*p)
		}
	}
	trim(body.DisplayName)
	trim(body.HomeArea)
	trim(body.ExperienceLevel)
	trim(body.Bio)

	runes := func(p *string) int { return len([]rune(*p)) }
	switch {
	case body.DisplayName != nil && (*body.DisplayName == "" || runes(body.DisplayName) > 50):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "display name must be 1 to 50 characters"})
		return
	case body.HomeArea != nil && runes(body.HomeArea) > 80:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "home area must be at most 80 characters"})
		return
	case body.Bio != nil && runes(body.Bio) > 500:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bio must be at most 500 characters"})
		return
	case body.ExperienceLevel != nil && *body.ExperienceLevel != "" && !slices.Contains(experienceLevels, *body.ExperienceLevel):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "experience level must be beginner, intermediate, advanced or expert"})
		return
	case body.DefaultLicence != nil && !slices.Contains(licences, *body.DefaultLicence):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "licence must be cc0, cc-by, cc-by-nc or all-rights-reserved"})
		return
	}

	// $n IS NULL = field absent → keep. Experience "" clears it.
	u, err := a.scanUser(a.db.QueryRow(r.Context(), `
		UPDATE users SET
			display_name     = coalesce($2, display_name),
			home_area        = coalesce($3, home_area),
			experience_level = CASE WHEN $4::text IS NULL THEN experience_level
			                        ELSE nullif($4, '')::experience_level END,
			bio              = coalesce($5, bio),
			default_licence  = coalesce($6::media_licence, default_licence),
			hide_locations   = coalesce($7, hide_locations),
			private_profile  = coalesce($8, private_profile),
			notify_ids       = coalesce($9, notify_ids),
			notify_status    = coalesce($10, notify_status),
			notify_comments  = coalesce($11, notify_comments),
			notify_reminders = coalesce($12, notify_reminders),
			hide_from_leaderboards = coalesce($13, hide_from_leaderboards)
		WHERE id = $1
		RETURNING `+userColumns,
		userID(r), body.DisplayName, body.HomeArea, body.ExperienceLevel, body.Bio, body.DefaultLicence,
		body.HideLocations, body.PrivateProfile, body.NotifyIDs, body.NotifyStatus, body.NotifyComments, body.NotifyReminders, body.HideFromBoards))
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "account no longer exists"})
		return
	}
	if err != nil {
		internalError(w, "update profile", err)
		return
	}
	writeJSON(w, http.StatusOK, u)
}

// PUT /me/avatar — multipart form, field "image". Stored as a 512 px square JPEG.
func (a *server) putAvatar(w http.ResponseWriter, r *http.Request) {
	id := userID(r)
	if a.rateLimited(r.Context(), "avatar:"+strconv.FormatInt(id, 10), 20, time.Hour) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "too many uploads, try again later"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes+1<<20)
	file, _, err := r.FormFile("image")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": `send the image as multipart field "image"`})
		return
	}
	defer file.Close()
	jpg, _, _, err := processImage(file, 512, 0)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	key := newKey("avatars/"+strconv.FormatInt(id, 10)+"/", ".jpg")
	if err := a.media.putJPEG(r.Context(), key, jpg); err != nil {
		internalError(w, "store avatar", err)
		return
	}
	var old *string
	err = a.db.QueryRow(r.Context(),
		`UPDATE users u SET avatar_key = $2 FROM users prev WHERE u.id = $1 AND prev.id = u.id RETURNING prev.avatar_key`,
		id, key).Scan(&old)
	if err != nil {
		a.media.remove(r.Context(), key)
		internalError(w, "save avatar", err)
		return
	}
	if old != nil {
		a.media.remove(r.Context(), *old)
	}
	u, err := a.loadUser(r.Context(), id)
	if err != nil {
		internalError(w, "load user", err)
		return
	}
	writeJSON(w, http.StatusOK, u)
}

// DELETE /me/avatar
func (a *server) deleteAvatar(w http.ResponseWriter, r *http.Request) {
	var old *string
	err := a.db.QueryRow(r.Context(),
		`UPDATE users u SET avatar_key = NULL FROM users prev WHERE u.id = $1 AND prev.id = u.id RETURNING prev.avatar_key`,
		userID(r)).Scan(&old)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		internalError(w, "delete avatar", err)
		return
	}
	if old != nil {
		a.media.remove(r.Context(), *old)
	}
	w.WriteHeader(http.StatusNoContent)
}

type publicProfile struct {
	ID              int64       `json:"id"`
	DisplayName     string      `json:"display_name"`
	AvatarURL       *string     `json:"avatar_url"`
	HomeArea        string      `json:"home_area"`
	ExperienceLevel string      `json:"experience_level"`
	Bio             string      `json:"bio"`
	CreatedAt       time.Time   `json:"created_at"`
	Private         bool        `json:"private"`
	Role            string      `json:"role"`       // shows Trusted / Verifier badges
	Reputation      *reputation `json:"reputation"` // VER-06; hidden on private profiles
	XP              *int        `json:"xp"`         // GAM-02; hidden on private profiles
	LevelName       string      `json:"level_name"`
}

// POST /me/guidelines — COM-06: record that the user accepted the community guidelines.
func (a *server) acceptGuidelines(w http.ResponseWriter, r *http.Request) {
	u, err := a.scanUser(a.db.QueryRow(r.Context(), `
		UPDATE users SET guidelines_accepted_at = coalesce(guidelines_accepted_at, now()) WHERE id = $1
		RETURNING `+userColumns, userID(r)))
	if err != nil {
		internalError(w, "accept guidelines", err)
		return
	}
	writeJSON(w, http.StatusOK, u)
}

// GET /users/{id} — public, no email. A private profile (ACC-08) shows only name and avatar to others.
func (a *server) getProfile(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	u, err := a.loadUser(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		internalError(w, "get profile", err)
		return
	}
	p := publicProfile{u.ID, u.DisplayName, u.AvatarURL, u.HomeArea, u.ExperienceLevel, u.Bio, u.CreatedAt, u.PrivateProfile, u.Role, nil, nil, ""}
	if u.PrivateProfile && viewerID(r) != u.ID {
		p.HomeArea, p.ExperienceLevel, p.Bio = "", "", ""
	} else {
		rep, err := loadReputation(r.Context(), a.db, u.ID) // VER-06
		if err != nil {
			internalError(w, "reputation", err)
			return
		}
		p.Reputation = &rep
		xp, err := loadXP(r.Context(), a.db, u.ID)
		if err != nil {
			internalError(w, "xp", err)
			return
		}
		p.XP, p.LevelName = &xp.XP, xp.LevelName
	}
	writeJSON(w, http.StatusOK, p)
}

// GET /me/stats — counts for the profile header: sightings, distinct species (own or community ID), IDs given to others.
func (a *server) myStats(w http.ResponseWriter, r *http.Request) {
	var sightings, species, ids int
	err := a.db.QueryRow(r.Context(), `
		SELECT (SELECT count(*) FROM observations WHERE user_id = $1),
		       (SELECT count(DISTINCT coalesce(community_species_id, species_id)) FROM observations WHERE user_id = $1),
		       (SELECT count(*) FROM identifications WHERE user_id = $1 AND is_current)`, userID(r)).Scan(&sightings, &species, &ids)
	if err != nil {
		internalError(w, "my stats", err)
		return
	}
	rep, err := loadReputation(r.Context(), a.db, userID(r))
	if err != nil {
		internalError(w, "reputation", err)
		return
	}
	xp, err := loadXP(r.Context(), a.db, userID(r))
	if err != nil {
		internalError(w, "xp", err)
		return
	}
	var followers, following int // COM-02
	if err := a.db.QueryRow(r.Context(), `SELECT (SELECT count(*) FROM follows WHERE followee_id = $1)::int,
		(SELECT count(*) FROM follows WHERE follower_id = $1)::int`, userID(r)).Scan(&followers, &following); err != nil {
		internalError(w, "follows", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sightings": sightings, "species": species, "identifications": ids, "xp": xp,
		"followers": followers, "following": following,
		"reputation": rep, "trusted_at": trustedMinConfirmed, "trusted_accuracy": int(trustedMinAccuracy * 100)})
}
