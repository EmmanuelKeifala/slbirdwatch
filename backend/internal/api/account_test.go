package api

import (
	"net/http"
	"testing"
)

func TestDeleteAndExportAccount(t *testing.T) {
	call, email := apiTest(t)

	code, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	if code != http.StatusCreated {
		t.Fatalf("signup: %d %v", code, out)
	}
	phone := out["token"].(string)
	_, out = call("POST", "/auth/login", "", creds(email, "correct horse", ""))
	tablet := out["token"].(string)

	code, out = call("GET", "/me/export", phone, "")
	u, _ := out["user"].(map[string]any)
	if code != http.StatusOK || u["email"] != email || out["exported_at"] == nil {
		t.Fatalf("export: %d %v", code, out)
	}
	if _, leaked := u["password_hash"]; leaked {
		t.Fatal("export leaks password hash")
	}

	if code, _ := call("DELETE", "/me", phone, `{"password":"wrong password"}`); code != http.StatusForbidden {
		t.Fatalf("delete with wrong password: %d", code)
	}
	if code, _ := call("DELETE", "/me", phone, `{"password":"correct horse"}`); code != http.StatusNoContent {
		t.Fatalf("delete: %d", code)
	}
	for name, tok := range map[string]string{"phone": phone, "tablet": tablet} {
		if code, _ := call("GET", "/me", tok, ""); code != http.StatusUnauthorized {
			t.Fatalf("%s session survived deletion: %d", name, code)
		}
	}
	if code, _ := call("POST", "/auth/login", "", creds(email, "correct horse", "")); code != http.StatusUnauthorized {
		t.Fatalf("login after deletion: %d", code)
	}
	if code, _ := call("POST", "/auth/signup", "", creds(email, "new password", "Ada")); code != http.StatusCreated {
		t.Fatalf("email not freed after deletion: %d", code)
	}
}
