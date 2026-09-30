package api

import (
	"context"
	"strconv"
	"testing"
	"time"
)

func TestLikes(t *testing.T) {
	call, email := apiTest(t)
	db := testDB(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	ada := out["token"].(string)
	_, out = call("POST", "/auth/signup", "", creds("b-"+email, "correct horse", "Bo"))
	bo := out["token"].(string)
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, "b-"+email) })
	_, o := call("POST", "/observations", ada, `{"observed_at":"`+time.Now().UTC().Format(time.RFC3339)+`","lat":8.4,"lng":-13.2}`)
	oid := strconv.Itoa(int(o["id"].(float64)))

	if code, _ := call("PUT", "/observations/"+oid+"/like", "", ""); code != 401 {
		t.Errorf("guest like: %d", code)
	}
	for i := 0; i < 2; i++ { // liking twice is still one like
		if code, v := call("PUT", "/observations/"+oid+"/like", bo, ""); code != 200 || v["likes"].(float64) != 1 {
			t.Fatalf("like: %d %v", code, v)
		}
	}
	if _, v := call("GET", "/observations/"+oid, bo, ""); v["likes"].(float64) != 1 || v["liked"] != true {
		t.Errorf("Bo's view: %v %v", v["likes"], v["liked"])
	}
	if _, v := call("GET", "/observations/"+oid, ada, ""); v["likes"].(float64) != 1 || v["liked"] != false {
		t.Errorf("Ada's view: %v %v", v["likes"], v["liked"])
	}
	if code, v := call("DELETE", "/observations/"+oid+"/like", bo, ""); code != 200 || v["likes"].(float64) != 0 {
		t.Errorf("unlike: %d %v", code, v)
	}
	db.Exec(t.Context(), `UPDATE observations SET hidden = true WHERE id = $1`, oid)
	if code, _ := call("PUT", "/observations/"+oid+"/like", bo, ""); code != 404 {
		t.Errorf("hidden sighting: %d", code)
	}
	call("POST", "/auth/signup", "", creds("c-"+email, "correct horse", "Cy"))
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, "c-"+email) })
	var adaID int64
	db.QueryRow(t.Context(), `SELECT id FROM users WHERE email = $1`, email).Scan(&adaID)
	call("PUT", "/users/"+strconv.FormatInt(adaID, 10)+"/follow", bo, "")
	if _, s := call("GET", "/me/stats", ada, ""); s["followers"].(float64) != 1 || s["following"].(float64) != 0 {
		t.Errorf("follow counts: %v %v", s["followers"], s["following"])
	}
}
