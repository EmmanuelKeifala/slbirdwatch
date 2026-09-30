package api

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/slbirdwatch/backend/internal/storage"
)

const maxPhotosPerObservation = 10

type photo struct {
	ID        int64    `json:"id"`
	URL       string   `json:"url"`
	ThumbURL  string   `json:"thumb_url"`
	Width     int      `json:"width"`
	Height    int      `json:"height"`
	Licence   string   `json:"licence"`
	QuizOK    bool     `json:"quiz_suitable"`
	Reference bool     `json:"reference"` // VER-07
	Tags      []string `json:"tags"`      // LIB-08: male, female, juvenile, adult, breeding, non-breeding, in-flight
}

// withPhotos fills Photos and Sounds on each observation with one query.
func (a *Server) withPhotos(ctx context.Context, obs []observation) error {
	if len(obs) == 0 {
		return nil
	}
	ids := make([]int64, len(obs))
	index := make(map[int64]int, len(obs))
	for i := range obs {
		ids[i] = obs[i].ID
		index[obs[i].ID] = i
		obs[i].Photos, obs[i].Sounds = []photo{}, []sound{}
	}
	rows, err := a.db.Query(ctx, `
		SELECT observation_id, id, kind, key, thumb_key, coalesce(width, 0), coalesce(height, 0), licence, quiz_suitable,
		       coalesce(duration_ms, 0), reference, tags
		FROM media WHERE observation_id = ANY($1) ORDER BY id`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var oid int64
		var p photo
		var kind, key, thumb string
		var durMS int
		if err := rows.Scan(&oid, &p.ID, &kind, &key, &thumb, &p.Width, &p.Height, &p.Licence, &p.QuizOK, &durMS, &p.Reference, &p.Tags); err != nil {
			return err
		}
		o := &obs[index[oid]]
		if kind == "sound" {
			o.Sounds = append(o.Sounds, sound{p.ID, a.media.URL(key), a.media.URL(thumb), float64(durMS) / 1000, p.Licence, p.Tags})
			continue
		}
		p.URL, p.ThumbURL = a.media.URL(key), a.media.URL(thumb)
		o.Photos = append(o.Photos, p)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	// COM-02: like counts, and whether the viewer (from the request context, 0 for guests) liked each
	viewer, _ := ctx.Value(ctxKey{}).(int64)
	likes, err := a.db.Query(ctx, `SELECT observation_id, count(*)::int, bool_or(user_id = $2) FROM observation_likes
		WHERE observation_id = ANY($1) GROUP BY 1`, ids, viewer)
	if err != nil {
		return err
	}
	var oid int64
	var n int
	var mine bool
	_, err = pgx.ForEachRow(likes, []any{&oid, &n, &mine}, func() error {
		obs[index[oid]].Likes, obs[index[oid]].Liked = n, mine
		return nil
	})
	return err
}

// PUT / DELETE /observations/{id}/like — COM-02. Not on hidden sightings or across a block.
func (a *Server) like(w http.ResponseWriter, r *http.Request) {
	oid, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	ctx, uid, liked := r.Context(), userID(r), r.Method != http.MethodDelete
	var err error
	if liked {
		var tag pgconn.CommandTag
		tag, err = a.db.Exec(ctx, `INSERT INTO observation_likes (observation_id, user_id)
			SELECT o.id, $1 FROM observations o WHERE o.id = $2 AND NOT o.hidden AND `+notBlocked("o.user_id")+`
			ON CONFLICT DO NOTHING`, uid, oid)
		if err == nil && tag.RowsAffected() == 0 {
			// Nothing inserted: liked already, or the sighting is missing, hidden or behind a block.
			var exists bool
			err = a.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM observation_likes WHERE observation_id = $1 AND user_id = $2)`, oid, uid).Scan(&exists)
			if err == nil && !exists {
				http.NotFound(w, r)
				return
			}
		}
	} else {
		_, err = a.db.Exec(ctx, `DELETE FROM observation_likes WHERE observation_id = $1 AND user_id = $2`, oid, uid)
	}
	var n int
	if err == nil {
		err = a.db.QueryRow(ctx, `SELECT count(*)::int FROM observation_likes WHERE observation_id = $1`, oid).Scan(&n)
	}
	if err != nil {
		internalError(w, "like", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"likes": n, "liked": liked})
}

// ownsObservation reports whether the observation exists and belongs to the caller.
func (a *Server) ownsObservation(r *http.Request, id int64) (bool, error) {
	var ok bool
	err := a.db.QueryRow(r.Context(), `SELECT EXISTS (SELECT 1 FROM observations WHERE id = $1 AND user_id = $2)`,
		id, userID(r)).Scan(&ok)
	return ok, err
}

// POST /observations/{id}/photos — OBS-02. Multipart field "image".
// Stores a ≤2048 px JPEG plus a ≤480 px thumbnail; both are re-encoded, so EXIF/GPS never leaves the server.
func (a *Server) addPhoto(w http.ResponseWriter, r *http.Request) {
	oid, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if ok, err := a.ownsObservation(r, oid); err != nil {
		internalError(w, "photo owner check", err)
		return
	} else if !ok {
		http.NotFound(w, r)
		return
	}
	if a.rateLimited(r.Context(), "photo:"+strconv.FormatInt(userID(r), 10), 200, time.Hour) {
		writeError(w, http.StatusTooManyRequests, "too many uploads, try again later")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, storage.MaxUploadBytes+1<<20)
	file, _, err := r.FormFile("image")
	if err != nil {
		writeError(w, http.StatusBadRequest, `send the image as multipart field "image"`)
		return
	}
	defer file.Close()
	licence := r.FormValue("licence") // empty = the uploader's default
	if licence != "" && !slices.Contains(licences, licence) {
		writeError(w, http.StatusBadRequest, "licence must be cc0, cc-by, cc-by-nc or all-rights-reserved")
		return
	}
	full, thumb, width, height, err := storage.ProcessImageWithThumb(file, 2048, 480)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	hash, err := dHash(thumb) // the hash is scale-invariant; the thumbnail decodes ~20x faster
	if err != nil {
		internalError(w, "photo hash", err)
		return
	}
	if msg, err := a.photoDuplicate(r.Context(), hash, userID(r), oid); err != nil {
		internalError(w, "duplicate check", err)
		return
	} else if msg != "" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": msg, "code": "duplicate_photo"})
		return
	}

	prefix := "observations/" + strconv.FormatInt(oid, 10) + "/"
	key, thumbKey := storage.NewKey(prefix, ".jpg"), storage.NewKey(prefix+"thumb-", ".jpg")
	if err := a.media.PutJPEG(r.Context(), key, full); err != nil {
		internalError(w, "store photo", err)
		return
	}
	if err := a.media.PutJPEG(r.Context(), thumbKey, thumb); err != nil {
		a.media.Remove(r.Context(), key)
		internalError(w, "store thumbnail", err)
		return
	}

	var p photo
	err = a.db.QueryRow(r.Context(), `
		INSERT INTO media (observation_id, kind, key, thumb_key, width, height, licence, phash)
		SELECT $1, 'photo', $2, $3, $4, $5,
		       coalesce(nullif($7, '')::media_licence, (SELECT default_licence FROM users WHERE id = $8)), $9
		WHERE (SELECT count(*) FROM media WHERE observation_id = $1 AND kind = 'photo') < $6
		RETURNING id, licence`, oid, key, thumbKey, width, height, maxPhotosPerObservation, licence, userID(r), hash).Scan(&p.ID, &p.Licence)
	if err != nil {
		a.media.Remove(r.Context(), key)
		a.media.Remove(r.Context(), thumbKey)
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusBadRequest, "an observation can have at most 10 photos")
			return
		}
		internalError(w, "save photo", err)
		return
	}
	// ponytail: count-then-insert isn't serialisable; two racing uploads at 9 photos could make 11. Add a lock if it matters.
	p.URL, p.ThumbURL, p.Width, p.Height, p.QuizOK, p.Tags = a.media.URL(key), a.media.URL(thumbKey), width, height, true, []string{}
	writeJSON(w, http.StatusCreated, p)
}

// DELETE /observations/{id}/photos/{photoID} (also /sounds/{photoID}) — any media item of the caller's observation.
func (a *Server) deletePhoto(w http.ResponseWriter, r *http.Request) {
	oid, err1 := strconv.ParseInt(r.PathValue("id"), 10, 64)
	pid, err2 := strconv.ParseInt(r.PathValue("photoID"), 10, 64)
	if err1 != nil || err2 != nil {
		http.NotFound(w, r)
		return
	}
	var key, thumb string
	err := a.db.QueryRow(r.Context(), `
		DELETE FROM media m USING observations o
		WHERE m.id = $1 AND m.observation_id = $2 AND o.id = m.observation_id AND o.user_id = $3
		RETURNING m.key, m.thumb_key`, pid, oid, userID(r)).Scan(&key, &thumb)
	if errors.Is(err, pgx.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		internalError(w, "delete photo", err)
		return
	}
	a.media.Remove(r.Context(), key)
	a.media.Remove(r.Context(), thumb)
	w.WriteHeader(http.StatusNoContent)
}

// userMediaKeys lists every stored object for a user's observations (for account deletion).
func (a *Server) userMediaKeys(ctx context.Context, userID int64) ([]string, error) {
	rows, err := a.db.Query(ctx, `
		SELECT m.key, m.thumb_key FROM media m JOIN observations o ON o.id = m.observation_id WHERE o.user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var keys []string
	for rows.Next() {
		var k string
		var t *string
		if err := rows.Scan(&k, &t); err != nil {
			return nil, err
		}
		keys = append(keys, k)
		if t != nil {
			keys = append(keys, *t)
		}
	}
	return keys, rows.Err()
}
