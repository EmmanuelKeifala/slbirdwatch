package api

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
)

func TestDuels(t *testing.T) {
	call, email := apiTest(t)
	db := testDB(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	ada := out["token"].(string)
	_, out = call("POST", "/auth/signup", "", creds("b-"+email, "correct horse", "Bo"))
	bo := out["token"].(string)
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, "b-"+email) })

	code, d := call("POST", "/duels", ada, `{"kind":"picture"}`)
	if code == 409 {
		t.Skip("no seeded quiz media")
	}
	if code != 200 || len(d["code"].(string)) != 6 {
		t.Fatalf("create: %d %v", code, d)
	}
	c := d["code"].(string)
	qs := d["questions"].([]any)
	right := make([]int64, len(qs)) // Ada gets all right, Bo all but one
	for i, q := range qs {
		right[i] = int64(q.(map[string]any)["answer"].(map[string]any)["id"].(float64))
	}
	picks := func(p []int64) string { b, _ := json.Marshal(p); return string(b) }
	if code, _ := call("POST", "/duels/"+c+"/score", ada, `{"picks":[1],"time_ms":1000}`); code != 400 {
		t.Errorf("wrong number of picks: %d", code)
	}
	call("POST", "/duels/"+c+"/score", ada, fmt.Sprintf(`{"picks":%s,"time_ms":42000}`, picks(right)))
	if code, _ := call("POST", "/duels/"+c+"/score", ada, fmt.Sprintf(`{"picks":%s,"time_ms":1000}`, picks(right))); code != 409 {
		t.Errorf("played twice: %d", code)
	}
	boPicks := append([]int64{}, right...)
	boPicks[0] = 0
	_, v := call("POST", "/duels/"+c+"/score", bo, fmt.Sprintf(`{"picks":%s,"time_ms":30000}`, picks(boPicks)))
	scores := v["scores"].([]any)
	first, second := scores[0].(map[string]any), scores[1].(map[string]any)
	if first["right"].(float64) != float64(len(qs)) || second["right"].(float64) != float64(len(qs)-1) || second["me"] != true || v["played"] != true {
		t.Fatalf("scores: %v", scores)
	}
	if _, my := call("GET", "/me/duels", bo, ""); len(my["items"].([]any)) != 1 {
		t.Errorf("Bo's duels: %v", my)
	}
	if code, _ := call("GET", "/duels/ZZZZZZ", bo, ""); code != 404 {
		t.Errorf("unknown code: %d", code)
	}
	db.Exec(t.Context(), `UPDATE duels SET expires_at = now() - interval '1 minute' WHERE code = $1`, c)
	_, out = call("POST", "/auth/signup", "", creds("c-"+email, "correct horse", "Cy"))
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, "c-"+email) })
	if code, _ := call("POST", "/duels/"+c+"/score", out["token"].(string), fmt.Sprintf(`{"picks":%s,"time_ms":1000}`, picks(right))); code != 410 {
		t.Errorf("closed challenge: %d", code)
	}
}
