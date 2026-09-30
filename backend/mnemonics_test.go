package main

import (
	"context"
	"strconv"
	"testing"
)

func TestMnemonics(t *testing.T) {
	call, email := apiTest(t)
	db := testDB(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	member := out["token"].(string)
	_, out = call("POST", "/auth/signup", "", creds("v-"+email, "correct horse", "Vi"))
	vi := out["token"].(string)
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, "v-"+email) })
	db.Exec(t.Context(), `UPDATE users SET role = 'verifier' WHERE email = $1`, "v-"+email)
	id := func(sci string) string {
		var n int64
		db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = $1`, sci).Scan(&n)
		return strconv.FormatInt(n, 10)
	}
	dove, crow := id("Streptopelia semitorquata"), id("Corvus albus")
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM species_mnemonics WHERE species_id = $1`, crow) })

	if _, sp := call("GET", "/species/"+dove, "", ""); sp["mnemonic"] == "" { // seeded
		t.Errorf("Red-eyed Dove: no phrase")
	}
	if code, _ := call("PUT", "/species/"+crow+"/mnemonic", member, `{"text":"Caw!"}`); code != 403 {
		t.Fatalf("member: %d", code)
	}
	if code, _ := call("PUT", "/species/"+crow+"/mnemonic", vi, `{"text":"x"}`); code != 400 {
		t.Errorf("too short: %d", code)
	}
	call("PUT", "/species/"+crow+"/mnemonic", vi, `{"text":"A harsh “kraa” from a rooftop"}`)
	if _, sp := call("GET", "/species/"+crow, "", ""); sp["mnemonic"] != "A harsh “kraa” from a rooftop" {
		t.Errorf("species page: %v", sp["mnemonic"])
	}
	if _, c := call("GET", "/species/cards?ids="+crow, "", ""); c["items"].([]any)[0].(map[string]any)["mnemonic"] != "A harsh “kraa” from a rooftop" {
		t.Errorf("flashcard: %v", c["items"])
	}
	call("PUT", "/species/"+crow+"/mnemonic", vi, `{"text":""}`)
	if _, sp := call("GET", "/species/"+crow, "", ""); sp["mnemonic"] != "" {
		t.Errorf("after removing: %v", sp["mnemonic"])
	}
}
