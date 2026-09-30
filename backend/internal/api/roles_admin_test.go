package api

import (
	"context"
	"strconv"
	"testing"
)

func TestRoleAssignment(t *testing.T) {
	call, email := apiTest(t)
	db := testDB(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	admin := out["token"].(string)
	adminID := strconv.Itoa(int(out["user"].(map[string]any)["id"].(float64)))
	_, out = call("POST", "/auth/signup", "", creds("p-"+email, "correct horse", "Zebedee Testperson"))
	member := out["token"].(string)
	pid := strconv.Itoa(int(out["user"].(map[string]any)["id"].(float64)))
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, "p-"+email) })
	db.Exec(t.Context(), `UPDATE users SET role = 'admin' WHERE email = $1`, email)

	if code, _ := call("GET", "/admin/users?q=zebedee", member, ""); code != 403 {
		t.Fatalf("member search: %d", code)
	}
	_, res := call("GET", "/admin/users?q=zebedee+test", admin, "")
	if items := res["items"].([]any); len(items) != 1 || items[0].(map[string]any)["role"] != "member" {
		t.Fatalf("search: %v", res["items"])
	}
	if code, _ := call("PUT", "/admin/users/"+pid+"/role", admin, `{"role":"wizard"}`); code != 400 {
		t.Errorf("bad role: %d", code)
	}
	if code, _ := call("PUT", "/admin/users/"+adminID+"/role", admin, `{"role":"member"}`); code != 403 {
		t.Errorf("own role: %d", code)
	}
	if code, _ := call("PUT", "/admin/users/"+pid+"/role", admin, `{"role":"verifier"}`); code != 204 {
		t.Fatalf("set role: %d", code)
	}
	if _, me := call("GET", "/me", member, ""); me["role"] != "verifier" {
		t.Errorf("role now %v", me["role"]) // applies at once, same session
	}
	var note string
	db.QueryRow(t.Context(), `SELECT note FROM moderation_actions WHERE target_id = $1 AND action = 'role'`, pid).Scan(&note)
	if note != "member → verifier" {
		t.Errorf("log %q", note)
	}
	if code, _ := call("PUT", "/admin/users/999999999/role", admin, `{"role":"verifier"}`); code != 404 {
		t.Errorf("missing user: %d", code)
	}
}
