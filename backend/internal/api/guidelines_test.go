package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestGuidelinesGate(t *testing.T) {
	h := testRouter(t)
	db := testDB(t)
	email := fmt.Sprintf("gate-%d@example.com", time.Now().UnixNano())
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
	_, out := do("POST", "/auth/signup", "", creds(email, "correct horse", "Gate"))
	token := out["token"].(string)
	if out["user"].(map[string]any)["guidelines_accepted"] != false {
		t.Fatal("new account starts with guidelines accepted")
	}
	obs := `{"observed_at":"` + time.Now().UTC().Format(time.RFC3339) + `","lat":8.48,"lng":-13.23}`
	if code, body := do("POST", "/observations", token, obs); code != http.StatusForbidden || body["code"] != "guidelines_required" {
		t.Fatalf("upload before accepting: %d %v", code, body)
	}
	if code, u := do("POST", "/me/guidelines", token, ""); code != 200 || u["guidelines_accepted"] != true {
		t.Fatalf("accept: %d %v", code, u)
	}
	if code, _ := do("POST", "/observations", token, obs); code != http.StatusCreated {
		t.Fatalf("upload after accepting: %d", code)
	}
}
