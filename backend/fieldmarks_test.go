package main

import (
	"context"
	"fmt"
	"strconv"
	"testing"
)

func TestFieldMarks(t *testing.T) {
	call, email := apiTest(t)
	db := testDB(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	member := out["token"].(string)
	_, out = call("POST", "/auth/signup", "", creds("v-"+email, "correct horse", "Vi"))
	vi := out["token"].(string)
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, "v-"+email) })
	db.Exec(t.Context(), `UPDATE users SET role = 'verifier' WHERE email = $1`, "v-"+email)
	var sp, gid int64
	db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = 'Aptenodytes forsteri'`).Scan(&sp)
	db.QueryRow(t.Context(), `INSERT INTO species_gallery (species_id, key, thumb_key, width, height, credit, licence, licence_url, source_url, source_id)
		VALUES ($1, 'fm-k', 'fm-t', 1, 1, 'G', 'CC0', 'u', 'u', 'test:marks') RETURNING id`, sp).Scan(&gid)
	ref := "gallery:" + strconv.FormatInt(gid, 10)
	t.Cleanup(func() {
		db.Exec(context.Background(), `DELETE FROM species_gallery WHERE source_id = 'test:marks'`)
		db.Exec(context.Background(), `DELETE FROM field_marks WHERE media_ref = $1`, ref)
	})
	mark := func(tok, label string, x float64) (int, map[string]any) {
		return call("POST", "/photos/marks", tok, fmt.Sprintf(`{"media_ref":%q,"x":%v,"y":0.3,"label":%q}`, ref, x, label))
	}
	if code, _ := mark(member, "white eye-ring", 0.5); code != 403 {
		t.Fatalf("member: %d", code)
	}
	if code, _ := mark(vi, "white eye-ring", 0.5); code != 404 {
		t.Fatalf("not a reference photo yet: %d", code)
	}
	call("PUT", "/verify/reference", vi, `{"media_ref":"`+ref+`","reference":true}`)
	for _, bad := range []struct {
		label string
		x     float64
	}{{"x", 0.5}, {"off the photo", 1.5}} {
		if code, _ := mark(vi, bad.label, bad.x); code != 400 {
			t.Errorf("%q at %v: %d", bad.label, bad.x, code)
		}
	}
	code, m := mark(vi, "white eye-ring", 0.42)
	if code != 201 || m["label"] != "white eye-ring" {
		t.Fatalf("add: %d %v", code, m)
	}
	_, page := call("GET", "/species/"+strconv.FormatInt(sp, 10), "", "")
	var marks []any
	for _, g := range page["gallery"].([]any) {
		if int64(g.(map[string]any)["id"].(float64)) == gid {
			marks = g.(map[string]any)["marks"].([]any)
		}
	}
	if len(marks) != 1 || marks[0].(map[string]any)["x"].(float64) < 0.41 {
		t.Fatalf("marks on the species page: %v", marks)
	}
	for i := 0; i < 7; i++ {
		mark(vi, fmt.Sprintf("mark %d", i), 0.1)
	}
	if code, _ := mark(vi, "one too many", 0.1); code != 400 {
		t.Errorf("ninth mark: %d", code)
	}
	id := strconv.Itoa(int(m["id"].(float64)))
	if code, _ := call("DELETE", "/photos/marks/"+id, member, ""); code != 403 {
		t.Errorf("member delete: %d", code)
	}
	if code, _ := call("DELETE", "/photos/marks/"+id, vi, ""); code != 204 {
		t.Errorf("delete: %d", code)
	}
}
