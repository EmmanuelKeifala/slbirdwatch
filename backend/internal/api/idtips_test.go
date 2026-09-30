package api

import (
	"context"
	"strconv"
	"testing"
)

func TestIDTips(t *testing.T) {
	call, email := apiTest(t)
	db := testDB(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	member := out["token"].(string)
	_, out = call("POST", "/auth/signup", "", creds("v-"+email, "correct horse", "Vi Expert"))
	expert := out["token"].(string)
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, "v-"+email) })
	db.Exec(t.Context(), `UPDATE users SET role = 'verifier' WHERE email = $1`, "v-"+email)
	var a, b int64
	db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = 'Corvus albus'`).Scan(&a)
	db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = 'Corvus corax'`).Scan(&b)
	t.Cleanup(func() {
		db.Exec(context.Background(), `DELETE FROM id_tips WHERE species_id = ANY($1) OR other_species_id = ANY($1)`, []int64{a, b})
	})
	sa, sb := strconv.FormatInt(a, 10), strconv.FormatInt(b, 10)

	if code, _ := call("PUT", "/species/"+sa+"/tips", member, `{"text":"Black and white, big bill."}`); code != 403 {
		t.Fatalf("member: %d", code)
	}
	if code, _ := call("PUT", "/species/"+sa+"/tips", expert, `{"text":"short"}`); code != 400 {
		t.Errorf("too short: %d", code)
	}
	if code, _ := call("PUT", "/species/"+sa+"/tips", expert, `{"other_species_id":`+sa+`,"text":"Itself, somehow."}`); code != 400 {
		t.Errorf("pair with itself: %d", code)
	}
	call("PUT", "/species/"+sa+"/tips", expert, `{"text":"The only crow here with a white breast and collar."}`)
	if _, cards := call("GET", "/species/cards?ids="+sa, "", ""); cards["items"].([]any)[0].(map[string]any)["tip"] != "The only crow here with a white breast and collar." {
		t.Errorf("flashcard tip: %v", cards["items"])
	}
	// written from B's page, stored once for the pair, and a rewrite replaces it
	call("PUT", "/species/"+sb+"/tips", expert, `{"other_species_id":`+sa+`,"text":"Raven is all black."}`)
	call("PUT", "/species/"+sb+"/tips", expert, `{"other_species_id":`+sa+`,"text":"Raven is all black; Pied Crow has a white collar."}`)

	_, got := call("GET", "/species/"+sa+"/tips", "", "")
	items := got["items"].([]any)
	if len(items) != 2 || items[0].(map[string]any)["other"] != nil || items[0].(map[string]any)["author"] != "Vi Expert" {
		t.Fatalf("A's tips: %v", items)
	}
	pair := items[1].(map[string]any)
	if pair["other"].(map[string]any)["id"].(float64) != float64(b) || pair["text"] != "Raven is all black; Pied Crow has a white collar." {
		t.Fatalf("pair tip on A: %v", pair)
	}
	_, got = call("GET", "/species/"+sb+"/tips", "", "")
	if items := got["items"].([]any); len(items) != 1 || items[0].(map[string]any)["other"].(map[string]any)["id"].(float64) != float64(a) {
		t.Fatalf("B's tips: %v", items)
	}
	pid := strconv.Itoa(int(pair["id"].(float64)))
	if code, _ := call("DELETE", "/tips/"+pid, member, ""); code != 403 {
		t.Errorf("member delete: %d", code)
	}
	if code, _ := call("DELETE", "/tips/"+pid, expert, ""); code != 204 {
		t.Errorf("delete: %d", code)
	}
	if _, got := call("GET", "/species/"+sb+"/tips", "", ""); len(got["items"].([]any)) != 0 {
		t.Errorf("after delete: %v", got["items"])
	}
}
