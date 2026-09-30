package api

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestGoogleSignIn(t *testing.T) {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	other, _ := rsa.GenerateKey(rand.Reader, 2048)
	b64 := base64.RawURLEncoding.EncodeToString
	certs := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{
			"kid": "k1", "n": b64(key.N.Bytes()), "e": b64(big.NewInt(int64(key.E)).Bytes())}}})
	}))
	defer certs.Close()
	oldURL := googleCertsURL
	googleCertsURL, googleKeys, googleKeysAt = certs.URL, map[string]*rsa.PublicKey{}, time.Time{}
	t.Cleanup(func() { googleCertsURL, googleKeys, googleKeysAt = oldURL, map[string]*rsa.PublicKey{}, time.Time{} })
	os.Setenv("GOOGLE_CLIENT_IDS", "web-client.apps.googleusercontent.com")
	t.Cleanup(func() { os.Unsetenv("GOOGLE_CLIENT_IDS") })

	sign := func(k *rsa.PrivateKey, claims map[string]any) string {
		h, _ := json.Marshal(map[string]string{"alg": "RS256", "kid": "k1"})
		c, _ := json.Marshal(claims)
		body := b64(h) + "." + b64(c)
		sum := sha256.Sum256([]byte(body))
		sig, _ := rsa.SignPKCS1v15(rand.Reader, k, crypto.SHA256, sum[:])
		return body + "." + b64(sig)
	}
	call, email := apiTest(t)
	claims := func(sub, mail string) map[string]any {
		return map[string]any{"iss": "https://accounts.google.com", "aud": "web-client.apps.googleusercontent.com", "sub": sub,
			"exp": time.Now().Add(time.Hour).Unix(), "email": mail, "email_verified": true, "name": "Ada Google"}
	}
	signIn := func(token string) (int, map[string]any) {
		return call("POST", "/auth/google", "", `{"id_token":"`+token+`"}`)
	}
	db := testDB(t)
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE google_sub LIKE 'test-sub-%'`) })

	// Existing password account with the same email gets linked, not duplicated.
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	existing := out["user"].(map[string]any)["id"]
	code, res := signIn(sign(key, claims("test-sub-1", email)))
	if code != 200 || res["user"].(map[string]any)["id"] != existing || res["token"] == nil {
		t.Fatalf("link: %d %v", code, res)
	}
	if code, res = signIn(sign(key, claims("test-sub-1", email))); code != 200 || res["user"].(map[string]any)["id"] != existing {
		t.Fatalf("again: %d %v", code, res)
	}
	// A new Google person gets a new account named from Google.
	newEmail := "g-" + email
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, newEmail) })
	if code, res = signIn(sign(key, claims("test-sub-2", newEmail))); code != 201 || res["user"].(map[string]any)["display_name"] != "Ada Google" {
		t.Fatalf("create: %d %v", code, res)
	}
	// Forged, wrong audience, expired, unverified email.
	bad := claims("test-sub-3", "x-"+email)
	wrongAud := claims("test-sub-3", "x-"+email)
	wrongAud["aud"] = "someone-else"
	expired := claims("test-sub-3", "x-"+email)
	expired["exp"] = time.Now().Add(-time.Hour).Unix()
	unverified := claims("test-sub-3", "x-"+email)
	unverified["email_verified"] = false
	for name, tc := range map[string]struct {
		token string
		want  int
	}{
		"forged": {sign(other, bad), 401}, "audience": {sign(key, wrongAud), 401}, "expired": {sign(key, expired), 401},
		"unverified": {sign(key, unverified), 400}, "garbage": {"a.b.c", 401},
	} {
		if code, _ := signIn(tc.token); code != tc.want {
			t.Errorf("%s: %d, want %d", name, code, tc.want)
		}
	}
	// Banned people stay out.
	db.Exec(t.Context(), `UPDATE users SET banned = true WHERE google_sub = 'test-sub-2'`)
	if code, res = signIn(sign(key, claims("test-sub-2", newEmail))); code != 403 || res["code"] != "banned" {
		t.Errorf("banned: %d %v", code, res)
	}
	// A Google-only account has no password and is deleted with a typed confirmation.
	db.Exec(t.Context(), `UPDATE users SET banned = false WHERE google_sub = 'test-sub-2'`)
	_, res = signIn(sign(key, claims("test-sub-2", newEmail)))
	tok := res["token"].(string)
	if res["user"].(map[string]any)["has_password"] != false {
		t.Errorf("has_password %v", res["user"].(map[string]any)["has_password"])
	}
	if code, _ := call("DELETE", "/me", tok, `{"password":"DELETE","confirm":"DELETE"}`); code != 204 {
		t.Errorf("delete Google-only account: %d", code)
	}
}
