package main

import (
	"context"
	"fmt"
	"strconv"
	"testing"
	"time"
)

func TestReputationAndTrusted(t *testing.T) {
	call, email := apiTest(t)
	db := testDB(t)
	tokens := map[string]string{}
	ids := map[string]string{}
	for _, who := range []string{"owner", "member", "verifier"} {
		e := who + "-" + email
		_, out := call("POST", "/auth/signup", "", creds(e, "correct horse", who))
		tokens[who] = out["token"].(string)
		ids[who] = strconv.Itoa(int(out["user"].(map[string]any)["id"].(float64)))
		t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, e) })
	}
	db.Exec(t.Context(), `UPDATE users SET role = 'verifier' WHERE id = $1`, ids["verifier"])
	sp := func(sci string) string {
		var id int64
		db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = $1`, sci).Scan(&id)
		return strconv.FormatInt(id, 10)
	}
	crow, houseCrow := sp("Corvus albus"), sp("Corvus splendens")
	// Each round: the owner posts an unknown bird, the member suggests Pied Crow, the verifier decides.
	round := func(i int, verdict string) {
		t.Helper()
		_, o := call("POST", "/observations", tokens["owner"], `{"observed_at":"`+time.Now().Add(-time.Duration(i)*time.Hour).UTC().Format(time.RFC3339)+
			`","lat":`+fmt.Sprint(8+float64(i)*0.01)+`,"lng":-13.2}`)
		oid := strconv.Itoa(int(o["id"].(float64)))
		call("POST", "/observations/"+oid+"/identifications", tokens["member"], `{"species_id":`+crow+`}`)
		call("POST", "/observations/"+oid+"/identifications", tokens["verifier"], `{"species_id":`+verdict+`}`)
	}
	role := func() string {
		var r string
		db.QueryRow(t.Context(), `SELECT role::text FROM users WHERE id = $1`, ids["member"]).Scan(&r)
		return r
	}

	round(0, houseCrow) // one wrong
	for i := 1; i <= 19; i++ {
		round(i, crow)
	}
	_, st := call("GET", "/me/stats", tokens["member"], "")
	rep := st["reputation"].(map[string]any)
	if rep["confirmed"].(float64) != 19 || rep["wrong"].(float64) != 1 || rep["accuracy"].(float64) != 95 || role() != "member" {
		t.Fatalf("after 19: %v, role %s", rep, role())
	}
	round(20, crow)
	if role() != "trusted" {
		t.Fatalf("20 confirmed at 95%% should make a Trusted member, role %s", role())
	}
	var note string
	db.QueryRow(t.Context(), `SELECT note FROM moderation_actions WHERE target_id = $1 AND action = 'role'`, ids["member"]).Scan(&note)
	if note != "member → trusted (automatic: 20 confirmed IDs, 95% right)" {
		t.Errorf("log %q", note)
	}
	_, p := call("GET", "/users/"+ids["member"], "", "")
	if p["role"] != "trusted" || p["reputation"].(map[string]any)["confirmed"].(float64) != 20 {
		t.Errorf("public profile %v", p)
	}
}
