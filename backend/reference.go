package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

// VER-07: reference-quality photos, chosen by verifiers.

var licenceLabels = map[string]string{"cc0": "CC0", "cc-by": "CC BY 4.0", "cc-by-nc": "CC BY-NC 4.0", "all-rights-reserved": "All rights reserved"}

// PUT /verify/reference {media_ref: "photo:<id>" | "gallery:<id>", reference} (verifier+).
// Only photos from verified sightings can be reference quality: the ID behind them must be settled.
func (a *server) setReference(w http.ResponseWriter, r *http.Request) {
	var body struct {
		MediaRef  string `json:"media_ref"`
		Reference bool   `json:"reference"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	kind, idStr, _ := strings.Cut(body.MediaRef, ":")
	id, err := strconv.ParseInt(idStr, 10, 64)
	var sql string
	switch {
	case err != nil:
	case kind == "photo":
		sql = `UPDATE media m SET reference = $2 FROM observations o
		       WHERE m.id = $1 AND m.kind = 'photo' AND o.id = m.observation_id AND o.status = 'verified' AND NOT o.hidden`
	case kind == "gallery":
		sql = `UPDATE species_gallery SET reference = $2 WHERE id = $1`
	}
	if sql == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": `media_ref must be "photo:<id>" or "gallery:<id>"`})
		return
	}
	tag, err := a.db.Exec(r.Context(), sql, id, body.Reference)
	if err != nil {
		internalError(w, "set reference", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such photo, or its sighting isn't verified yet"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// referenceImage is the newest reference photo of a species (community first, then gallery), as a hero image.
func (a *server) referenceImage(ctx context.Context, speciesID int64) (*speciesImage, error) {
	var key, thumb, credit, licence, source string
	err := a.db.QueryRow(ctx, `
		SELECT key, thumb_key, credit, licence, source FROM (
			SELECT m.key, m.thumb_key, u.display_name AS credit, m.licence::text AS licence, '' AS source, 0 AS pri, m.id
			FROM media m JOIN observations o ON o.id = m.observation_id JOIN users u ON u.id = o.user_id
			WHERE m.reference AND m.kind = 'photo' AND o.status = 'verified' AND NOT o.hidden AND o.community_species_id = $1
			UNION ALL
			SELECT g.key, g.thumb_key, g.credit, g.licence, g.source_url, 1, g.id FROM species_gallery g
			WHERE g.reference AND g.species_id = $1
		) x ORDER BY pri, id DESC LIMIT 1`, speciesID).Scan(&key, &thumb, &credit, &licence, &source)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if l, ok := licenceLabels[licence]; ok {
		licence = l
	}
	return &speciesImage{URL: a.media.url(key), ThumbURL: a.media.url(thumb), Credit: credit, Licence: licence, SourceURL: source}, nil
}
