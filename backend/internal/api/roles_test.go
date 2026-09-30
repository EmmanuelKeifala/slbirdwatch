package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/slbirdwatch/backend/internal/database"
)

func TestRoleAtLeast(t *testing.T) {
	cases := []struct {
		have, want string
		ok         bool
	}{
		{"member", "member", true},
		{"member", "trusted", false},
		{"verifier", "trusted", true},
		{"moderator", "verifier", true},
		{"admin", "moderator", true},
		{"trusted", "admin", false},
		{"bogus", "member", false},
	}
	for _, c := range cases {
		if got := roleAtLeast(c.have, c.want); got != c.ok {
			t.Errorf("roleAtLeast(%q, %q) = %v, want %v", c.have, c.want, got, c.ok)
		}
	}
}

func TestRequireRole(t *testing.T) {
	ctx := t.Context()
	db := testDB(t)
	if err := database.Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	cache, _ := database.OpenRedis()
	if err := cache.Ping(ctx).Err(); err != nil {
		t.Skipf("redis not available: %v", err)
	}
	t.Cleanup(func() { cache.Close() })

	// The Go enum order must match Postgres's, or roleAtLeast lies.
	var pgRoles []string
	if err := db.QueryRow(ctx, `SELECT enum_range(NULL::user_role)::text[]`).Scan(&pgRoles); err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(pgRoles) != fmt.Sprint(roles) {
		t.Fatalf("user_role enum %v != Go roles %v", pgRoles, roles)
	}

	a := &Server{db: db, cache: cache}
	email := fmt.Sprintf("role-%d@example.com", time.Now().UnixNano())
	var id int64
	if err := db.QueryRow(ctx, `INSERT INTO users (email, display_name) VALUES ($1, 'R') RETURNING id`, email).Scan(&id); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Exec(ctx, `DELETE FROM users WHERE id = $1`, id) })
	token, err := a.newSession(ctx, id)
	if err != nil {
		t.Fatal(err)
	}

	h := a.requireRole("verifier", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	status := func(tok string) int {
		req := httptest.NewRequest("GET", "/", nil)
		if tok != "" {
			req.Header.Set("Authorization", "Bearer "+tok)
		}
		rec := httptest.NewRecorder()
		h(rec, req)
		return rec.Code
	}

	if got := status(""); got != http.StatusUnauthorized {
		t.Fatalf("no token: %d", got)
	}
	if got := status(token); got != http.StatusForbidden {
		t.Fatalf("member on verifier route: %d", got)
	}
	db.Exec(ctx, `UPDATE users SET role = 'moderator' WHERE id = $1`, id)
	if got := status(token); got != http.StatusOK {
		t.Fatalf("moderator on verifier route: %d (role change should apply immediately)", got)
	}
}
