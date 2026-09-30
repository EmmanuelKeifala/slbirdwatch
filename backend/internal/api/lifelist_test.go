package api

import (
	"context"
	"strconv"
	"testing"
	"time"
)

func TestLifeList(t *testing.T) {
	call, email := apiTest(t)
	db := testDB(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	me := out["token"].(string)
	_, out = call("POST", "/auth/signup", "", creds("v-"+email, "correct horse", "Vi"))
	ver := out["token"].(string)
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, "v-"+email) })
	db.Exec(t.Context(), `UPDATE users SET role = 'verifier' WHERE email = $1`, "v-"+email)
	sp := func(sci string) string {
		var id int64
		db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = $1`, sci).Scan(&id)
		return strconv.FormatInt(id, 10)
	}
	crow, houseCrow := sp("Corvus albus"), sp("Corvus splendens")
	now := time.Now().UTC()
	_, o := call("POST", "/observations", me, `{"species_id":`+crow+`,"observed_at":"`+now.Add(-48*time.Hour).Format(time.RFC3339)+`","lat":8.4,"lng":-13.2}`)
	call("POST", "/observations/"+strconv.Itoa(int(o["id"].(float64)))+"/identifications", ver, `{"species_id":`+crow+`}`)
	call("POST", "/observations", me, `{"species_id":`+houseCrow+`,"observed_at":"`+now.Format(time.RFC3339)+`","lat":8.5,"lng":-13.2}`)

	_, l := call("GET", "/me/lifelist", me, "")
	items := l["items"].([]any)
	if len(items) != 2 || l["verified"].(float64) != 1 {
		t.Fatalf("life list %v", l)
	}
	first, second := items[0].(map[string]any), items[1].(map[string]any)
	if first["english_name"] != "Pied Crow" || first["verified"] != true || second["verified"] != false {
		t.Errorf("order/verified: %v / %v", first, second)
	}
	_, n := call("GET", "/me/learn-next", me, "")
	next := n["items"].([]any)
	if len(next) == 0 || len(next) > 12 {
		t.Fatalf("learn next %d", len(next))
	}
	for _, it := range next {
		id := strconv.Itoa(int(it.(map[string]any)["id"].(float64)))
		if id == crow || id == houseCrow {
			t.Errorf("suggested a bird already recorded: %v", it)
		}
	}
	if code, _ := call("GET", "/me/lifelist", "", ""); code != 401 {
		t.Errorf("guest: %d", code)
	}
}
