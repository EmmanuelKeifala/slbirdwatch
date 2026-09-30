package api

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/slbirdwatch/backend/internal/config"
)

// ACC-02b: sign in with Google. The app gets an ID token from Google's native sign-in; we check its signature
// against Google's published keys (stdlib RSA, no SDK), its issuer, audience (our client ids) and expiry.

var (
	googleCertsURL = "https://www.googleapis.com/oauth2/v3/certs" // overridden in tests
	googleKeysMu   sync.Mutex
	googleKeys     = map[string]*rsa.PublicKey{}
	googleKeysAt   time.Time
)

// googleClientIDs: the OAuth client ids whose tokens we accept (the web client id the app is configured with).
func googleClientIDs() []string {
	var out []string
	for id := range strings.SplitSeq(config.Env("GOOGLE_CLIENT_IDS", ""), ",") {
		if id = strings.TrimSpace(id); id != "" {
			out = append(out, id)
		}
	}
	return out
}

func googleKey(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	googleKeysMu.Lock()
	defer googleKeysMu.Unlock()
	if k := googleKeys[kid]; k != nil {
		return k, nil
	}
	if time.Since(googleKeysAt) < time.Minute {
		return nil, errors.New("unknown signing key")
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, googleCertsURL, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var set struct {
		Keys []struct{ Kid, N, E string } `json:"keys"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&set); err != nil {
		return nil, err
	}
	googleKeys, googleKeysAt = map[string]*rsa.PublicKey{}, time.Now() // Google rotates keys: keep only current ones
	for _, k := range set.Keys {
		n, err1 := base64.RawURLEncoding.DecodeString(k.N)
		e, err2 := base64.RawURLEncoding.DecodeString(k.E)
		if err1 != nil || err2 != nil {
			continue
		}
		googleKeys[k.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(new(big.Int).SetBytes(e).Int64())}
	}
	if k := googleKeys[kid]; k != nil {
		return k, nil
	}
	return nil, errors.New("unknown signing key")
}

type googleClaims struct {
	Iss           string `json:"iss"`
	Aud           string `json:"aud"`
	Sub           string `json:"sub"`
	Exp           int64  `json:"exp"`
	Email         string `json:"email"`
	EmailVerified any    `json:"email_verified"` // bool, sometimes "true"
	Name          string `json:"name"`
}

func verifyGoogleIDToken(ctx context.Context, token string, audiences []string) (*googleClaims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, errors.New("malformed token")
	}
	var head struct{ Alg, Kid string }
	hb, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || json.Unmarshal(hb, &head) != nil || head.Alg != "RS256" {
		return nil, errors.New("unsupported token")
	}
	key, err := googleKey(ctx, head.Kid)
	if err != nil {
		return nil, err
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, errors.New("malformed signature")
	}
	sum := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if err := rsa.VerifyPKCS1v15(key, crypto.SHA256, sum[:], sig); err != nil {
		return nil, errors.New("bad signature")
	}
	var c googleClaims
	cb, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || json.Unmarshal(cb, &c) != nil {
		return nil, errors.New("malformed claims")
	}
	switch {
	case c.Iss != "accounts.google.com" && c.Iss != "https://accounts.google.com":
		return nil, errors.New("wrong issuer")
	case !slices.Contains(audiences, c.Aud):
		return nil, errors.New("token is for another app")
	case time.Now().Unix() > c.Exp:
		return nil, errors.New("token expired")
	case c.Sub == "":
		return nil, errors.New("no account id")
	}
	return &c, nil
}

// POST /auth/google {id_token} — signs in; links to an existing account with the same (Google-verified) email;
// otherwise creates one. 201 when created, 200 otherwise.
func (a *Server) googleSignIn(w http.ResponseWriter, r *http.Request) {
	if a.rateLimited(r.Context(), "google:"+clientIP(r), 30, 15*time.Minute) {
		writeError(w, http.StatusTooManyRequests, "too many attempts, try again in 15 minutes")
		return
	}
	var body struct {
		IDToken string `json:"id_token"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&body); err != nil || body.IDToken == "" {
		writeError(w, http.StatusBadRequest, "id_token is required")
		return
	}
	ids := googleClientIDs()
	if len(ids) == 0 {
		writeError(w, http.StatusServiceUnavailable, "Google sign-in isn't set up on this server")
		return
	}
	c, err := verifyGoogleIDToken(r.Context(), body.IDToken, ids)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "Google sign-in failed: "+err.Error())
		return
	}
	verified := c.EmailVerified == true || c.EmailVerified == "true"
	email := strings.ToLower(strings.TrimSpace(c.Email))
	if !verified || !validEmail(email) {
		writeError(w, http.StatusBadRequest, "your Google account has no verified email")
		return
	}
	name := strings.TrimSpace(c.Name)
	if name == "" {
		name, _, _ = strings.Cut(email, "@")
	}
	if r := []rune(name); len(r) > 50 {
		name = string(r[:50])
	}

	var banned bool
	var suspendedUntil *time.Time
	status := http.StatusOK
	// 1) already linked, 2) same verified email: link it, 3) new account.
	ret := `RETURNING ` + userColumns + `, banned, suspended_until`
	u, err := a.scanUser(a.db.QueryRow(r.Context(), `UPDATE users SET google_sub = $1 WHERE google_sub = $1 `+ret, c.Sub), &banned, &suspendedUntil)
	if errors.Is(err, pgx.ErrNoRows) {
		u, err = a.scanUser(a.db.QueryRow(r.Context(), `UPDATE users SET google_sub = $1 WHERE google_sub IS NULL AND email = $2 `+ret,
			c.Sub, email), &banned, &suspendedUntil)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		status = http.StatusCreated
		u, err = a.scanUser(a.db.QueryRow(r.Context(), `INSERT INTO users (email, display_name, google_sub) VALUES ($1, $2, $3) `+ret,
			email, name, c.Sub), &banned, &suspendedUntil)
	}
	if pgCode(err) == uniqueViolation {
		writeError(w, http.StatusConflict, "an account with this email is linked to a different Google account")
		return
	}
	if err != nil {
		internalError(w, "google sign-in", fmt.Errorf("%s: %w", email, err))
		return
	}
	if banned {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "this account has been banned", "code": "banned"})
		return
	}
	if suspendedUntil != nil && suspendedUntil.After(time.Now()) {
		writeJSON(w, http.StatusForbidden, map[string]string{
			"error": "this account is suspended until " + suspendedUntil.Format("2 Jan 2006"), "code": "suspended"})
		return
	}
	a.respondWithSession(w, r, status, u)
}
