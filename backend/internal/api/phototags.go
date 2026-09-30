package api

import (
	"encoding/json"
	"net/http"
	"slices"
	"strconv"
	"strings"
)

// LIB-08: photo tags, in display order. Each pair can't both apply to one bird.
var photoTags = []string{"male", "female", "juvenile", "adult", "breeding", "non-breeding", "in-flight"}

// LIB-09: recording tags, as on the Xeno-canto sound gallery (a recording can hold several).
var soundTags = []string{"song", "call", "alarm", "flight"}
var tagClashes = [][2]string{{"male", "female"}, {"juvenile", "adult"}, {"breeding", "non-breeding"}, {"juvenile", "breeding"}}

// cleanTags sorts and de-duplicates tags (from vocab), rejecting unknown ones and contradictions.
func cleanTags(in, vocab []string) ([]string, string) {
	out := []string{}
	for _, t := range vocab {
		if slices.Contains(in, t) {
			out = append(out, t)
		}
	}
	for _, t := range in {
		if !slices.Contains(vocab, t) {
			return nil, "unknown tag " + strconv.Quote(t)
		}
	}
	for _, c := range tagClashes {
		if slices.Contains(out, c[0]) && slices.Contains(out, c[1]) {
			return nil, c[0] + " and " + c[1] + " can't both apply"
		}
	}
	return out, ""
}

// PUT /photos/tags {media_ref: "photo:<id>" | "sound:<id>" | "gallery:<id>", tags} — the sighting's observer or a verifier
// for community photos and recordings; verifiers only for gallery photos (whose variant follows the sex/age tag).
func (a *Server) setPhotoTags(w http.ResponseWriter, r *http.Request) {
	var body struct {
		MediaRef string   `json:"media_ref"`
		Tags     []string `json:"tags"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	kind, idStr, _ := strings.Cut(body.MediaRef, ":")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || (kind != "photo" && kind != "sound" && kind != "gallery") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": `media_ref must be "photo:<id>", "sound:<id>" or "gallery:<id>"`})
		return
	}
	vocab := photoTags
	if kind == "sound" {
		vocab = soundTags
	}
	tags, msg := cleanTags(body.Tags, vocab)
	if msg != "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
		return
	}
	var verifier bool
	if err := a.db.QueryRow(r.Context(), `SELECT role >= 'verifier' FROM users WHERE id = $1`, userID(r)).Scan(&verifier); err != nil {
		internalError(w, "photo tags role", err)
		return
	}
	sql := `UPDATE media m SET tags = $2 FROM observations o
	        WHERE m.id = $1 AND m.kind = $5::text AND o.id = m.observation_id AND (o.user_id = $3 OR $4)`
	if kind == "gallery" {
		if !verifier {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "only verifiers can tag gallery photos"})
			return
		}
		sql = `UPDATE species_gallery SET tags = $2,
		       variant = coalesce((SELECT t FROM unnest($2::text[]) t WHERE t IN ('male', 'female', 'juvenile', 'adult') LIMIT 1), '')
		       WHERE id = $1 AND $3::bigint IS NOT NULL AND $4 AND $5::text = 'gallery'`
	}
	tag, err := a.db.Exec(r.Context(), sql, id, tags, userID(r), verifier, kind)
	if err != nil {
		internalError(w, "photo tags", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such photo, or it isn't yours to tag"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tags": tags})
}
