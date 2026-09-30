package main

import (
	"context"
	"fmt"
	"strconv"
	"testing"
	"time"
)

func TestGroups(t *testing.T) {
	call, email := apiTest(t)
	db := testDB(t)
	signup := func(p string) (string, int64) {
		_, out := call("POST", "/auth/signup", "", creds(p+email, "correct horse", "User "+p))
		if p != "" {
			t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, p+email) })
		}
		return out["token"].(string), int64(out["user"].(map[string]any)["id"].(float64))
	}
	owner, ownerID := signup("")
	bo, boID := signup("b-")
	cy, _ := signup("c-")

	if code, _ := call("POST", "/groups", owner, `{"name":"x"}`); code != 400 {
		t.Errorf("short name: %d", code)
	}
	code, g := call("POST", "/groups", owner, `{"name":"Tacugama Bird Club","description":"Weekend walks.","kind":"club"}`)
	if code != 201 || g["members"].(float64) != 1 || len(g["join_code"].(string)) != 6 {
		t.Fatalf("create: %d %v", code, g)
	}
	gid := strconv.Itoa(int(g["id"].(float64)))
	defer db.Exec(context.Background(), `DELETE FROM groups WHERE id = $1`, gid)

	if code, _ := call("GET", "/groups/"+gid, cy, ""); code != 404 {
		t.Errorf("outsider sees the group: %d", code)
	}
	if code, _ := call("POST", "/groups/join", bo, `{"code":"ZZZZZZ"}`); code != 404 {
		t.Errorf("wrong code: %d", code)
	}
	if code, j := call("POST", "/groups/join", bo, fmt.Sprintf(`{"code":"%s"}`, g["join_code"])); code != 200 || j["members"].(float64) != 2 {
		t.Fatalf("join: %d %v", code, j)
	}

	// Bo's verified sighting this week: shows in the group, counts for the board and the group quiz
	var crow int64
	db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = 'Corvus albus'`).Scan(&crow)
	db.Exec(t.Context(), `INSERT INTO observations (user_id, species_id, community_species_id, observed_at, location, status)
		VALUES ($1, $2, $2, now(), 'POINT(-13.2 8.4)', 'verified')`, boID, crow)
	if _, err := db.Exec(t.Context(), `INSERT INTO outings (user_id, client_id, started_at) VALUES ($1, 'grp', now())`, boID); err != nil {
		t.Fatal(err)
	}
	start := time.Now().UTC().Add(-time.Hour).Format(time.RFC3339)
	end := time.Now().UTC().Add(30 * 24 * time.Hour).Format(time.RFC3339)
	if code, _ := call("POST", "/groups/"+gid+"/challenges", bo, `{"title":"50 together","goal":50,"starts_at":"`+start+`","ends_at":"`+end+`"}`); code != 403 {
		t.Errorf("member sets challenge: %d", code)
	}
	if code, _ := call("POST", "/groups/"+gid+"/challenges", owner, `{"title":"50 together","goal":50,"starts_at":"`+start+`","ends_at":"`+end+`"}`); code != 201 {
		t.Fatalf("owner sets challenge: %d", code)
	}
	_, v := call("GET", "/groups/"+gid, owner, "")
	members := v["members"].([]any)
	top := members[0].(map[string]any)
	if len(members) != 2 || int64(top["id"].(float64)) != boID || top["week_xp"].(float64) != 35 { // 10 + a lifer 25
		t.Fatalf("board: %v", members)
	}
	if ch := v["challenges"].([]any); len(ch) != 1 || ch[0].(map[string]any)["species"].(float64) != 1 {
		t.Errorf("challenge progress: %v", ch)
	}
	if o := v["outings"].([]any); len(o) != 1 {
		t.Errorf("outings: %v", o)
	}
	if _, s := call("GET", "/groups/"+gid+"/sightings", owner, ""); len(s["items"].([]any)) != 1 {
		t.Errorf("sightings: %v", s["items"])
	}
	if _, q := call("GET", "/quiz/picture?scope=group&group="+gid+"&n=5", owner, ""); q["questions"] != nil {
		for _, x := range q["questions"].([]any) {
			if int64(x.(map[string]any)["answer"].(map[string]any)["id"].(float64)) != crow {
				t.Errorf("group quiz asked about another bird")
			}
		}
	}
	if code, _ := call("GET", "/quiz/picture?scope=group&group="+gid, cy, ""); code != 404 {
		t.Errorf("outsider group quiz: %d", code)
	}

	// owner can't leave; members can; owner removes; new code
	if code, _ := call("DELETE", "/groups/"+gid+"/members/me", owner, ""); code != 400 {
		t.Errorf("owner leaving: %d", code)
	}
	if code, _ := call("DELETE", fmt.Sprintf("/groups/%s/members/%d", gid, ownerID), bo, ""); code != 403 {
		t.Errorf("member removing owner: %d", code)
	}
	_, nc := call("POST", "/groups/"+gid+"/code", owner, "")
	if nc["join_code"] == g["join_code"] {
		t.Error("code unchanged")
	}
	if code, _ := call("POST", "/groups/join", cy, fmt.Sprintf(`{"code":"%s"}`, g["join_code"])); code != 404 {
		t.Errorf("old code still works: %d", code)
	}
	if code, _ := call("DELETE", "/groups/"+gid+"/members/me", bo, ""); code != 204 {
		t.Errorf("leave: %d", code)
	}
	if _, my := call("GET", "/me/groups", bo, ""); len(my["items"].([]any)) != 0 {
		t.Errorf("still in group")
	}
}
