package main

import (
	"context"
	"strconv"
	"testing"
	"time"
)

func TestRareAlerts(t *testing.T) {
	call, email := apiTest(t)
	db := testDB(t)
	signup := func(p, name string) string {
		_, out := call("POST", "/auth/signup", "", creds(p+email, "correct horse", name))
		if p != "" {
			t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, p+email) })
		}
		return out["token"].(string)
	}
	ada, near, far, off, vi := signup("", "Ada"), signup("n-", "Near"), signup("f-", "Far"), signup("o-", "Off"), signup("v-", "Vi")
	db.Exec(t.Context(), `UPDATE users SET role = 'verifier' WHERE email = $1`, "v-"+email)

	if code, _ := call("PUT", "/me/rare-alerts", near, `{"on":true,"km":25}`); code != 400 {
		t.Errorf("on without a place: %d", code)
	}
	call("PUT", "/me/rare-alerts", near, `{"on":true,"lat":8.45,"lng":-13.25,"km":25}`)
	call("PUT", "/me/rare-alerts", far, `{"on":true,"lat":7.9,"lng":-11.0,"km":25}`)
	call("PUT", "/me/rare-alerts", off, `{"on":false,"lat":8.45,"lng":-13.25,"km":25}`)
	if _, s := call("GET", "/me/rare-alerts", near, ""); s["on"] != true || s["km"].(float64) != 25 {
		t.Fatalf("settings: %v", s)
	}
	alerts := func(tok string) int {
		_, v := call("GET", "/me/notifications", tok, "")
		n := 0
		for _, it := range v["items"].([]any) {
			if it.(map[string]any)["kind"] == "rare" {
				n++
			}
		}
		return n
	}
	spot := 0.0
	post := func(sci string) string {
		spot += 0.01 // a new spot each time, so it isn't taken for a duplicate (OBS-15)
		var sp int64
		db.QueryRow(t.Context(), `SELECT id FROM species WHERE scientific_name = $1`, sci).Scan(&sp)
		_, o := call("POST", "/observations", ada, `{"species_id":`+strconv.FormatInt(sp, 10)+`,"observed_at":"`+time.Now().UTC().Format(time.RFC3339)+`","lat":`+strconv.FormatFloat(8.48+spot, 'f', 4, 64)+`,"lng":-13.23}`)
		oid := strconv.Itoa(int(o["id"].(float64)))
		call("POST", "/observations/"+oid+"/identifications", vi, `{"species_id":`+strconv.FormatInt(sp, 10)+`}`) // verified
		return oid
	}
	post("Corvus albus") // common: no alert
	if n := alerts(near); n != 0 {
		t.Fatalf("common bird alerted: %d", n)
	}
	post("Aptenodytes forsteri") // never recorded in Sierra Leone: rare
	if alerts(near) != 1 || alerts(far) != 0 || alerts(off) != 0 || alerts(ada) != 0 {
		t.Fatalf("rare alerts: near %d far %d off %d observer %d", alerts(near), alerts(far), alerts(off), alerts(ada))
	}
	db.Exec(t.Context(), `UPDATE species SET sensitive = true WHERE scientific_name = 'Aptenodytes forsteri'`)
	t.Cleanup(func() {
		db.Exec(context.Background(), `UPDATE species SET sensitive = false WHERE scientific_name = 'Aptenodytes forsteri'`)
	})
	post("Aptenodytes forsteri")
	if n := alerts(near); n != 1 {
		t.Errorf("sensitive bird alerted: %d", n)
	}
	if title, body := pushText("rare", "", "Emperor Penguin", ""); title != "Rare bird nearby" || body != "Emperor Penguin was just verified within your alert area" {
		t.Errorf("push text: %q %q", title, body)
	}
}
