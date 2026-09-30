package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"
)

func TestPushNotifications(t *testing.T) {
	got := make(chan []pushMessage, 4)
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var msgs []pushMessage
		json.NewDecoder(r.Body).Decode(&msgs)
		got <- msgs
		tickets := []map[string]any{}
		for _, m := range msgs {
			if m.To == "ExponentPushToken[dead]" {
				tickets = append(tickets, map[string]any{"status": "error", "details": map[string]string{"error": "DeviceNotRegistered"}})
			} else {
				tickets = append(tickets, map[string]any{"status": "ok", "id": "x"})
			}
		}
		json.NewEncoder(w).Encode(map[string]any{"data": tickets})
	}))
	defer fake.Close()
	old := pushURL
	pushURL = fake.URL
	t.Cleanup(func() { pushURL = old })

	call, email := apiTest(t)
	db := testDB(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	owner := out["token"].(string)
	_, out = call("POST", "/auth/signup", "", creds("h-"+email, "correct horse", "Bo"))
	helper := out["token"].(string)
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, "h-"+email) })

	if code, _ := call("POST", "/me/push-token", owner, `{"token":"not-a-token"}`); code != 400 {
		t.Fatalf("bad token: %d", code)
	}
	for _, tok := range []string{"ExponentPushToken[good]", "ExponentPushToken[dead]"} { // two phones signed in
		if code, _ := call("POST", "/me/push-token", owner, `{"token":"`+tok+`","platform":"android","device":"Phone `+tok[18:22]+`"}`); code != 204 {
			t.Fatalf("save token: %d", code)
		}
	}
	if _, d := call("GET", "/me/devices", owner, ""); len(d["items"].([]any)) != 2 || d["items"].([]any)[0].(map[string]any)["name"] == "" {
		t.Fatalf("devices %v", d["items"])
	}
	t.Cleanup(func() {
		db.Exec(context.Background(), `DELETE FROM push_tokens WHERE token IN ('ExponentPushToken[good]', 'ExponentPushToken[dead]')`)
	})

	_, sp := call("GET", "/species?q=pied+crow&limit=1", "", "")
	crow := strconv.Itoa(int(sp["items"].([]any)[0].(map[string]any)["id"].(float64)))
	_, o := call("POST", "/observations", owner, `{"observed_at":"`+time.Now().UTC().Format(time.RFC3339)+`","lat":8.4,"lng":-13.2}`)
	call("POST", "/observations/"+strconv.Itoa(int(o["id"].(float64)))+"/identifications", helper, `{"species_id":`+crow+`}`)

	select {
	case msgs := <-got:
		if len(msgs) != 2 || msgs[0].Title != "New ID on your sighting" || msgs[0].Body != "Bo identified your sighting as Pied Crow" ||
			msgs[0].Data["observation_id"] != o["id"] {
			t.Fatalf("pushed %+v", msgs)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no push sent")
	}
	// The dead token is forgotten; the good one stays.
	deadline := time.Now().Add(3 * time.Second)
	var n int
	for time.Now().Before(deadline) {
		db.QueryRow(t.Context(), `SELECT count(*) FROM push_tokens WHERE token IN ('ExponentPushToken[good]', 'ExponentPushToken[dead]')`).Scan(&n)
		if n == 1 {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if n != 1 {
		t.Errorf("%d tokens left, want 1", n)
	}
	// Sign-out removes this phone's token.
	call("DELETE", "/me/push-token?token=ExponentPushToken[good]", owner, "")
	db.QueryRow(t.Context(), `SELECT count(*) FROM push_tokens WHERE token = 'ExponentPushToken[good]'`).Scan(&n)
	if n != 0 {
		t.Error("token not removed")
	}
}
