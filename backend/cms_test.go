package main

import (
	"context"
	"fmt"
	"testing"
	"time"
)

func TestCMS(t *testing.T) {
	call, email := apiTest(t)
	db := testDB(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	member := out["token"].(string)
	_, out = call("POST", "/auth/signup", "", creds("a-"+email, "correct horse", "Admin"))
	admin := out["token"].(string)
	t.Cleanup(func() {
		db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, "a-"+email)
		db.Exec(context.Background(), `DELETE FROM lessons WHERE slug = 'test-crows'`)
	})
	db.Exec(t.Context(), `UPDATE users SET role = 'admin' WHERE email = $1`, "a-"+email)
	var crow, raven int64
	db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = 'Corvus albus'`).Scan(&crow)
	db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = 'Corvus corax'`).Scan(&raven)

	// lessons: the built-in ones came across; admins only; a hand-picked lesson keeps its order
	if _, l := call("GET", "/admin/lessons", admin, ""); len(l["items"].([]any)) < 10 {
		t.Fatalf("seeded lessons: %v", l)
	}
	body := fmt.Sprintf(`{"title":"Crows","blurb":"Two black birds.","species_ids":[%d,%d],"position":99,"published":false}`, raven, crow)
	if code, _ := call("PUT", "/admin/lessons/test-crows", member, body); code != 403 {
		t.Fatalf("member: %d", code)
	}
	for _, bad := range []string{
		`{"title":"X"}`, // too short
		fmt.Sprintf(`{"title":"Crows","species_ids":[%d,%d]}`, crow, crow),
		`{"title":"Crows","families":["Nopeidae"]}`,
	} {
		if code, _ := call("PUT", "/admin/lessons/test-crows", admin, bad); code != 400 {
			t.Errorf("%s: %d", bad, code)
		}
	}
	if code, _ := call("PUT", "/admin/lessons/Bad_Slug", admin, body); code != 400 {
		t.Errorf("bad slug accepted")
	}
	if code, _ := call("PUT", "/admin/lessons/test-crows", admin, body); code != 200 {
		t.Fatalf("save: %d", code)
	}
	if code, _ := call("GET", "/lessons/test-crows", "", ""); code != 404 {
		t.Errorf("hidden lesson is public: %d", code)
	}
	call("PUT", "/admin/lessons/test-crows", admin, fmt.Sprintf(`{"title":"Crows","species_ids":[%d,%d],"published":true}`, raven, crow))
	_, l := call("GET", "/lessons/test-crows", "", "")
	birds := l["birds"].([]any)
	if len(birds) != 2 || int64(birds[0].(map[string]any)["id"].(float64)) != raven {
		t.Fatalf("picked birds in order: %v", birds)
	}
	if code, _ := call("DELETE", "/admin/lessons/test-crows", admin, ""); code != 204 {
		t.Errorf("delete: %d", code)
	}

	// challenges: four weeks ahead, edit one, and last week's can't change
	_, c := call("GET", "/admin/challenges", admin, "")
	items := c["items"].([]any)
	if len(items) != 12 {
		t.Fatalf("four weeks of challenges: %d", len(items))
	}
	next := items[3].(map[string]any) // next week, slot 0
	id := fmt.Sprint(int64(next["id"].(float64)))
	if code, _ := call("PUT", "/admin/challenges/"+id, admin, `{"kind":"family_photo","param":"Nopeidae","title":"Hmm","description":"","goal":3}`); code != 400 {
		t.Errorf("unknown family: %d", code)
	}
	if code, _ := call("PUT", "/admin/challenges/"+id, admin, `{"kind":"species_week","title":"Twenty species","description":"Log 20 different species.","goal":20}`); code != 204 {
		t.Fatalf("edit: %d", code)
	}
	var title string
	var goal int
	db.QueryRow(t.Context(), `SELECT title, goal FROM challenges WHERE id = $1`, id).Scan(&title, &goal)
	if title != "Twenty species" || goal != 20 {
		t.Errorf("saved: %s %d", title, goal)
	}
	var old int64
	last := week(time.Now()).AddDate(0, 0, -7)
	db.QueryRow(t.Context(), `INSERT INTO challenges (week, slot, kind, title, description, goal) VALUES ($1, 9, 'quiz_days', 'Old', '', 1)
		ON CONFLICT (week, slot) DO UPDATE SET title = 'Old' RETURNING id`, last).Scan(&old)
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM challenges WHERE id = $1`, old) })
	if code, _ := call("PUT", "/admin/challenges/"+fmt.Sprint(old), admin, `{"kind":"quiz_days","title":"Changed","description":"","goal":1}`); code != 404 {
		t.Errorf("last week's challenge edited: %d", code)
	}
}
