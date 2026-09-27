package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/mail"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
)

const sessionTTL = 30 * 24 * time.Hour

type user struct {
	ID              int64       `json:"id"`
	Email           string      `json:"email"`
	DisplayName     string      `json:"display_name"`
	Role            string      `json:"role"`
	CreatedAt       time.Time   `json:"created_at"`
	AvatarURL       *string     `json:"avatar_url"`
	HomeArea        string      `json:"home_area"`
	ExperienceLevel string      `json:"experience_level"` // "" when not set
	Bio             string      `json:"bio"`
	DefaultLicence  string      `json:"default_licence"`        // OBS-12
	HideLocations   bool        `json:"hide_locations"`         // ACC-08
	PrivateProfile  bool        `json:"private_profile"`        // ACC-08
	GuidelinesOK    bool        `json:"guidelines_accepted"`    // COM-06
	NotifyIDs       bool        `json:"notify_ids"`             // NTF-04
	NotifyStatus    bool        `json:"notify_status"`          // NTF-04
	HasPassword     bool        `json:"has_password"`           // false for Google-only accounts (ACC-02b)
	NotifyComments  bool        `json:"notify_comments"`        // VER-09
	NotifyReminders bool        `json:"notify_reminders"`       // NTF-02
	HideFromBoards  bool        `json:"hide_from_leaderboards"` // GAM-05
	Warning         *modWarning `json:"warning,omitempty"`      // ADM-01, only on GET /me
}

type server struct {
	db    *pgxpool.Pool
	cache *redis.Client
	media *store
}

const userColumns = `id, email, display_name, role, created_at, avatar_key, home_area, coalesce(experience_level::text, ''), bio, default_licence, hide_locations, private_profile, guidelines_accepted_at IS NOT NULL, notify_ids, notify_status, password_hash IS NOT NULL, notify_comments, notify_reminders, hide_from_leaderboards`

// scanUser reads userColumns (plus any extra trailing columns) from row.
func (a *server) scanUser(row pgx.Row, extra ...any) (user, error) {
	var u user
	var avatarKey *string
	err := row.Scan(append([]any{&u.ID, &u.Email, &u.DisplayName, &u.Role, &u.CreatedAt,
		&avatarKey, &u.HomeArea, &u.ExperienceLevel, &u.Bio, &u.DefaultLicence, &u.HideLocations, &u.PrivateProfile, &u.GuidelinesOK,
		&u.NotifyIDs, &u.NotifyStatus, &u.HasPassword, &u.NotifyComments, &u.NotifyReminders, &u.HideFromBoards}, extra...)...)
	if avatarKey != nil {
		url := a.media.url(*avatarKey)
		u.AvatarURL = &url
	}
	return u, err
}

func (a *server) loadUser(ctx context.Context, id int64) (user, error) {
	return a.scanUser(a.db.QueryRow(ctx, `SELECT `+userColumns+` FROM users WHERE id = $1`, id))
}

// Compared against when the email is unknown, so login takes the same time either way.
var dummyHash, _ = bcrypt.GenerateFromPassword([]byte("not-a-real-password"), bcrypt.DefaultCost)

func sessionKey(token string) string {
	sum := sha256.Sum256([]byte(token)) // only the hash is stored, so a Redis dump leaks no usable tokens
	return "session:" + hex.EncodeToString(sum[:])
}

func (a *server) newSession(ctx context.Context, userID int64) (string, error) {
	b := make([]byte, 32)
	rand.Read(b)
	token := base64.RawURLEncoding.EncodeToString(b)
	key, set := sessionKey(token), userSessionsKey(userID)
	_, err := a.cache.TxPipelined(ctx, func(p redis.Pipeliner) error {
		p.Set(ctx, key, userID, sessionTTL)
		p.SAdd(ctx, set, key) // lets account deletion revoke every device
		p.Expire(ctx, set, sessionTTL)
		return nil
	})
	return token, err
}

func userSessionsKey(userID int64) string { return "user_sessions:" + strconv.FormatInt(userID, 10) }

// revokeAllSessions signs the user out everywhere.
func (a *server) revokeAllSessions(ctx context.Context, userID int64) error {
	set := userSessionsKey(userID)
	keys, err := a.cache.SMembers(ctx, set).Result()
	if err != nil {
		return err
	}
	return a.cache.Del(ctx, append(keys, set)...).Err()
}

func bearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if t, ok := strings.CutPrefix(h, "Bearer "); ok {
		return strings.TrimSpace(t)
	}
	return ""
}

// rateLimited allows `limit` hits per key per window.
func (a *server) rateLimited(ctx context.Context, key string, limit int64, window time.Duration) bool {
	key = "rl:" + key
	n, err := a.cache.Incr(ctx, key).Result()
	if err != nil {
		log.Printf("rate limit: %v", err)
		return false // fail open: Redis down shouldn't lock everyone out
	}
	if n == 1 {
		a.cache.Expire(ctx, key, window)
	}
	return n > limit
}

func clientIP(r *http.Request) string {
	// ponytail: RemoteAddr only; read X-Forwarded-For once we sit behind a known proxy.
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

type credentials struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name"`
}

func readCredentials(w http.ResponseWriter, r *http.Request) (credentials, bool) {
	var c credentials
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&c); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return c, false
	}
	c.Email = strings.ToLower(strings.TrimSpace(c.Email))
	c.DisplayName = strings.TrimSpace(c.DisplayName)
	return c, true
}

func validEmail(s string) bool {
	a, err := mail.ParseAddress(s)
	return err == nil && a.Address == s && strings.Contains(s[strings.LastIndex(s, "@"):], ".")
}

func (a *server) signup(w http.ResponseWriter, r *http.Request) {
	if a.rateLimited(r.Context(), "signup:"+clientIP(r), 10, time.Hour) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "too many sign-ups, try again later"})
		return
	}
	c, ok := readCredentials(w, r)
	if !ok {
		return
	}
	switch {
	case !validEmail(c.Email):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "enter a valid email address"})
		return
	case len(c.Password) < 8 || len(c.Password) > 72: // bcrypt ignores bytes past 72
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "password must be 8 to 72 characters"})
		return
	case c.DisplayName == "" || len([]rune(c.DisplayName)) > 50:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "display name must be 1 to 50 characters"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(c.Password), bcrypt.DefaultCost)
	if err != nil {
		internalError(w, "signup hash", err)
		return
	}
	u, err := a.scanUser(a.db.QueryRow(r.Context(),
		`INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING `+userColumns,
		c.Email, string(hash), c.DisplayName))
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "an account with this email already exists"})
		return
	}
	if err != nil {
		internalError(w, "signup insert", err)
		return
	}
	a.respondWithSession(w, r, http.StatusCreated, u)
}

func (a *server) login(w http.ResponseWriter, r *http.Request) {
	c, ok := readCredentials(w, r)
	if !ok {
		return
	}
	if a.rateLimited(r.Context(), "login:"+clientIP(r), 30, 15*time.Minute) ||
		a.rateLimited(r.Context(), "login:"+c.Email, 10, 15*time.Minute) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "too many attempts, try again in 15 minutes"})
		return
	}

	var hash *string
	var banned bool
	var suspendedUntil *time.Time
	u, err := a.scanUser(a.db.QueryRow(r.Context(),
		`SELECT `+userColumns+`, password_hash, banned, suspended_until FROM users WHERE email = $1`, c.Email),
		&hash, &banned, &suspendedUntil)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		internalError(w, "login lookup", err)
		return
	}
	stored := dummyHash
	if err == nil && hash != nil {
		stored = []byte(*hash)
	}
	if bcrypt.CompareHashAndPassword(stored, []byte(c.Password)) != nil || err != nil || hash == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "wrong email or password"})
		return
	}
	// ADM-01: only after the password checks out, so this doesn't reveal which emails exist.
	if banned {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "this account has been banned", "code": "banned"})
		return
	}
	if suspendedUntil != nil && suspendedUntil.After(time.Now()) {
		writeJSON(w, http.StatusForbidden, map[string]string{
			"error": "this account is suspended until " + suspendedUntil.Format("2 Jan 2006"), "code": "suspended"})
		return
	}
	a.respondWithSession(w, r, http.StatusOK, u)
}

func (a *server) respondWithSession(w http.ResponseWriter, r *http.Request, code int, u user) {
	token, err := a.newSession(r.Context(), u.ID)
	if err != nil {
		internalError(w, "new session", err)
		return
	}
	writeJSON(w, code, map[string]any{"token": token, "user": u})
}

func (a *server) logout(w http.ResponseWriter, r *http.Request) {
	if t := bearer(r); t != "" {
		key := sessionKey(t)
		if id, err := a.cache.GetDel(r.Context(), key).Int64(); err == nil {
			a.cache.SRem(r.Context(), userSessionsKey(id), key)
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

type ctxKey struct{}

// requireUser rejects requests without a valid session and puts the user id in the context.
// Sessions slide: each authenticated request extends the TTL.
func (a *server) requireUser(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		t := bearer(r)
		if t == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "sign in required"})
			return
		}
		v, err := a.cache.GetEx(r.Context(), sessionKey(t), sessionTTL).Result()
		if errors.Is(err, redis.Nil) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "session expired, sign in again"})
			return
		}
		if err != nil {
			internalError(w, "session lookup", err)
			return
		}
		id, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			internalError(w, "session value", fmt.Errorf("%q: %w", v, err))
			return
		}
		a.seen(id)
		next(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, id)))
	}
}

// seen records that a signed-in person used the app today (ADM-06: DAU/MAU, retention): Redis lets the first
// request of the day through to one insert, the rest cost a single SETNX.
func (a *server) seen(uid int64) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		day := time.Now().UTC().Format("2006-01-02")
		if ok, err := a.cache.SetNX(ctx, fmt.Sprintf("seen:%d:%s", uid, day), 1, 26*time.Hour).Result(); err != nil || !ok {
			return
		}
		if _, err := a.db.Exec(ctx, `INSERT INTO user_days (user_id, day) VALUES ($1, $2::date) ON CONFLICT DO NOTHING`, uid, day); err != nil {
			log.Printf("seen: %v", err)
		}
	}()
}

func userID(r *http.Request) int64 { return r.Context().Value(ctxKey{}).(int64) }

// viewerID is the signed-in user on an optionalUser route, or 0 for guests.
func viewerID(r *http.Request) int64 {
	id, _ := r.Context().Value(ctxKey{}).(int64)
	return id
}

// optionalUser identifies a signed-in viewer when a valid token is sent, and lets guests through otherwise.
func (a *server) optionalUser(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if t := bearer(r); t != "" {
			if v, err := a.cache.Get(r.Context(), sessionKey(t)).Int64(); err == nil {
				a.seen(v)
				r = r.WithContext(context.WithValue(r.Context(), ctxKey{}, v))
			}
		}
		next(w, r)
	}
}

// Roles, lowest to highest; must match the user_role enum order in 004_roles.sql.
// ponytail: linear hierarchy (a moderator can also verify); split into permission sets if roles diverge.
var roles = []string{"member", "trusted", "verifier", "moderator", "admin"}

func roleAtLeast(have, want string) bool {
	h, w := slices.Index(roles, have), slices.Index(roles, want)
	return h >= 0 && w >= 0 && h >= w
}

// requireRole is requireUser plus a minimum role. The role is read per request so changes apply at once.
func (a *server) requireRole(min string, next http.HandlerFunc) http.HandlerFunc {
	if !slices.Contains(roles, min) {
		panic("requireRole: unknown role " + min)
	}
	return a.requireUser(func(w http.ResponseWriter, r *http.Request) {
		var role string
		if err := a.db.QueryRow(r.Context(), `SELECT role FROM users WHERE id = $1`, userID(r)).Scan(&role); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "account no longer exists"})
				return
			}
			internalError(w, "role lookup", err)
			return
		}
		if !roleAtLeast(role, min) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "you don't have permission to do that"})
			return
		}
		next(w, r)
	})
}

func (a *server) me(w http.ResponseWriter, r *http.Request) {
	u, err := a.loadUser(r.Context(), userID(r))
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "account no longer exists"})
		return
	}
	if err != nil {
		internalError(w, "me", err)
		return
	}
	if u.Warning, err = a.latestWarning(r.Context(), u.ID); err != nil {
		internalError(w, "me warning", err)
		return
	}
	writeJSON(w, http.StatusOK, u)
}

func internalError(w http.ResponseWriter, what string, err error) {
	log.Printf("%s: %v", what, err)
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
}
