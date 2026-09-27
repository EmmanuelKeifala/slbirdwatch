package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// testRouter wires the full router against the compose Postgres + Redis + S3 (skips if any is down)
// and clears rate-limit counters (httptest requests all come from 192.0.2.1).
func testRouter(t *testing.T) http.Handler {
	t.Helper()
	ctx := context.Background()
	db := testDB(t)
	if err := migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	cache, _ := openCache()
	if err := cache.Ping(ctx).Err(); err != nil {
		t.Skipf("redis not available: %v", err)
	}
	t.Cleanup(func() { cache.Close() })
	if keys, _ := cache.Keys(ctx, "rl:*").Result(); len(keys) > 0 {
		cache.Del(ctx, keys...)
	}
	media, err := openStore(ctx)
	if err != nil {
		t.Skipf("s3 not available: %v", err)
	}
	return routes(db, cache, media)
}

// apiTest returns a JSON request helper and a unique email whose user is deleted after the test.
func apiTest(t *testing.T) (call func(method, path, token, body string) (int, map[string]any), email string) {
	t.Helper()
	h := testRouter(t)
	db := testDB(t)
	email = fmt.Sprintf("test-%d@example.com", time.Now().UnixNano())
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, email) })

	do := func(method, path, token, body string) (int, map[string]any) {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code, decode(rec.Body)
	}
	// New test accounts accept the community guidelines (COM-06) so tests can upload;
	// TestGuidelinesGate covers the gate itself without this helper.
	return func(method, path, token, body string) (int, map[string]any) {
		code, out := do(method, path, token, body)
		if method == "POST" && path == "/auth/signup" && code == http.StatusCreated {
			do("POST", "/me/guidelines", out["token"].(string), "")
		}
		return code, out
	}, email
}

func decode(r io.Reader) map[string]any {
	var out map[string]any
	json.NewDecoder(r).Decode(&out)
	return out
}

func creds(e, p, n string) string {
	b, _ := json.Marshal(map[string]string{"email": e, "password": p, "display_name": n})
	return string(b)
}

func TestEmailAuthFlow(t *testing.T) {
	call, email := apiTest(t)

	for _, bad := range []string{
		creds("not-an-email", "longenough", "Ada"),
		creds(email, "short", "Ada"),
		creds(email, "longenough", "  "),
		`{`,
	} {
		if code, _ := call("POST", "/auth/signup", "", bad); code != http.StatusBadRequest {
			t.Fatalf("signup %s: got %d, want 400", bad, code)
		}
	}

	code, out := call("POST", "/auth/signup", "", creds("  "+strings.ToUpper(email)+" ", "correct horse", "Ada"))
	if code != http.StatusCreated || out["token"] == "" {
		t.Fatalf("signup: %d %v", code, out)
	}
	if code, _ := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada")); code != http.StatusConflict {
		t.Fatalf("duplicate signup: got %d, want 409", code)
	}

	if code, _ := call("POST", "/auth/login", "", creds(email, "wrong password", "")); code != http.StatusUnauthorized {
		t.Fatalf("wrong password: got %d", code)
	}
	if code, _ := call("POST", "/auth/login", "", creds("nobody@example.com", "whatever1", "")); code != http.StatusUnauthorized {
		t.Fatalf("unknown email: got %d", code)
	}
	code, out = call("POST", "/auth/login", "", creds(email, "correct horse", ""))
	if code != http.StatusOK {
		t.Fatalf("login: %d %v", code, out)
	}
	token := out["token"].(string)

	if code, out := call("GET", "/me", token, ""); code != http.StatusOK || out["email"] != email || out["display_name"] != "Ada" {
		t.Fatalf("me: %d %v", code, out)
	}
	if code, _ := call("GET", "/me", "", ""); code != http.StatusUnauthorized {
		t.Fatalf("me without token: got %d", code)
	}
	if code, _ := call("POST", "/auth/logout", token, ""); code != http.StatusNoContent {
		t.Fatalf("logout: got %d", code)
	}
	if code, _ := call("GET", "/me", token, ""); code != http.StatusUnauthorized {
		t.Fatalf("me after logout: got %d", code)
	}

	// Per-email login limit: 10 per 15 min (2 attempts above already counted for this email).
	var last int
	for range 9 {
		last, _ = call("POST", "/auth/login", "", creds(email, "wrong password", ""))
	}
	if last != http.StatusTooManyRequests {
		t.Fatalf("rate limit: last status %d, want 429", last)
	}
}
