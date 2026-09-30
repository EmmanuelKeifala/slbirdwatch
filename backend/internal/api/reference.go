package api

import (
	"net/http"
	"strconv"
	"strings"
)

// VER-07: reference-quality photos, chosen by verifiers.

var licenceLabels = map[string]string{"cc0": "CC0", "cc-by": "CC BY 4.0", "cc-by-nc": "CC BY-NC 4.0", "all-rights-reserved": "All rights reserved"}

// PUT /verify/reference {media_ref: "photo:<id>" | "gallery:<id>", reference} (verifier+).
// Only photos from verified sightings can be reference quality: the ID behind them must be settled.
func (a *Server) setReference(w http.ResponseWriter, r *http.Request) {
	var body struct {
		MediaRef  string `json:"media_ref"`
		Reference bool   `json:"reference"`
	}
	if !readJSON(w, r, 1024, &body) {
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
		writeError(w, http.StatusBadRequest, `media_ref must be "photo:<id>" or "gallery:<id>"`)
		return
	}
	tag, err := a.db.Exec(r.Context(), sql, id, body.Reference)
	if err != nil {
		internalError(w, "set reference", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "no such photo, or its sighting isn't verified yet")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
