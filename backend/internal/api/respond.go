package api

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5/pgconn"
)

// HTTP plumbing shared by the handlers.

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

// writeError sends {"error": msg}, the message the app shows to the person.
func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

// internalError logs err and sends a generic 500, so internals never reach clients.
func internalError(w http.ResponseWriter, what string, err error) {
	log.Printf("%s: %v", what, err)
	writeError(w, http.StatusInternalServerError, "internal error")
}

// httpErr is a request failure from a helper, written by the handler.
type httpErr struct {
	code int
	msg  string
	err  error // for 500s
}

func (e *httpErr) write(w http.ResponseWriter) {
	if e.code == http.StatusInternalServerError {
		internalError(w, e.msg, e.err)
		return
	}
	writeError(w, e.code, e.msg)
}

// readJSON decodes a request body of at most maxBytes into v, or writes a 400 and returns false.
func readJSON(w http.ResponseWriter, r *http.Request, maxBytes int64, v any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBytes)).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return false
	}
	return true
}

// pathID parses the numeric path value `name`, or writes a 404 and returns false.
func pathID(w http.ResponseWriter, r *http.Request, name string) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue(name), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return 0, false
	}
	return id, true
}

// offsetParam is ?offset=, never negative.
func offsetParam(r *http.Request) int {
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	return max(offset, 0)
}

// page is one page of a list fetched with LIMIT limit+1: the extra row, if any, means there's a next page.
func page[T any](items []T, limit, offset int) map[string]any {
	if len(items) > limit {
		return map[string]any{"items": items[:limit], "next_offset": offset + limit}
	}
	return map[string]any{"items": items, "next_offset": nil}
}

// Postgres error codes the handlers turn into client errors.
const (
	uniqueViolation     = "23505"
	foreignKeyViolation = "23503"
	checkViolation      = "23514"
)

// pgCode is err's Postgres error code, or "" when it isn't a Postgres error.
func pgCode(err error) string {
	if e, ok := errors.AsType[*pgconn.PgError](err); ok {
		return e.Code
	}
	return ""
}
