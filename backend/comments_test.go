package main

import (
	"context"
	"strconv"
	"testing"
	"time"
)

func TestComments(t *testing.T) {
	call, email := apiTest(t)
	db := testDB(t)
	tok := map[string]string{}
	uid := map[string]string{}
	for _, who := range []string{"ada", "bo", "cy", "mo"} {
		e := who + "-" + email
		_, out := call("POST", "/auth/signup", "", creds(e, "correct horse", who))
		tok[who] = out["token"].(string)
		uid[who] = strconv.Itoa(int(out["user"].(map[string]any)["id"].(float64)))
		t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, e) })
	}
	db.Exec(t.Context(), `UPDATE users SET role = 'moderator' WHERE id = $1`, uid["mo"])
	_, o := call("POST", "/observations", tok["ada"], `{"observed_at":"`+time.Now().UTC().Format(time.RFC3339)+`","lat":8.4,"lng":-13.2}`)
	oid := strconv.Itoa(int(o["id"].(float64)))
	path := "/observations/" + oid + "/comments"

	if code, _ := call("POST", path, "", `{"body":"hi"}`); code != 401 {
		t.Fatalf("guest comment: %d", code)
	}
	if code, _ := call("POST", path, tok["bo"], `{"body":"   "}`); code != 400 {
		t.Errorf("empty comment: %d", code)
	}
	_, c1 := call("POST", path, tok["bo"], `{"body":"Lovely bird. Was it calling?"}`)
	cid := strconv.Itoa(int(c1["id"].(float64)))
	_, r1 := call("POST", path, tok["ada"], `{"body":"Yes, a harsh kraa.","parent_id":`+cid+`}`)
	if code, _ := call("POST", path, tok["bo"], `{"body":"reply to a reply","parent_id":`+strconv.Itoa(int(r1["id"].(float64)))+`}`); code != 400 {
		t.Errorf("nested reply: %d", code)
	}
	_, list := call("GET", path, "", "")
	threads := list["items"].([]any)
	if len(threads) != 1 || len(threads[0].(map[string]any)["replies"].([]any)) != 1 {
		t.Fatalf("threads %v", threads)
	}
	kinds := func(who string) map[string]int {
		_, n := call("GET", "/me/notifications", tok[who], "")
		out := map[string]int{}
		for _, it := range n["items"].([]any) {
			out[it.(map[string]any)["kind"].(string)]++
		}
		return out
	}
	if k := kinds("ada"); k["comment"] != 1 || k["reply"] != 0 {
		t.Errorf("owner notifications %v", k)
	}
	if k := kinds("bo"); k["reply"] != 1 {
		t.Errorf("replied-to notifications %v", k)
	}

	// Blocks: Ada blocks Cy; Cy can't comment, and neither sees the other's comments.
	call("PUT", "/users/"+uid["cy"]+"/block", tok["ada"], "")
	if code, _ := call("POST", path, tok["cy"], `{"body":"hello"}`); code != 403 {
		t.Errorf("blocked comment: %d", code)
	}
	if _, l := call("GET", path, tok["cy"], ""); len(l["items"].([]any)[0].(map[string]any)["replies"].([]any)) != 0 {
		t.Error("blocked person still sees Ada's reply")
	}

	// Delete own: the words go, the reply stays; someone else can't delete it.
	if code, _ := call("DELETE", "/comments/"+cid, tok["ada"], ""); code != 404 {
		t.Errorf("delete someone else's: %d", code)
	}
	call("DELETE", "/comments/"+cid, tok["bo"], "")
	_, list = call("GET", path, "", "")
	top := list["items"].([]any)[0].(map[string]any)
	if top["deleted"] != true || top["body"] != "" || len(top["replies"].([]any)) != 1 {
		t.Errorf("after delete %v", top)
	}

	// Report the reply; moderators see it and hide it.
	rid := strconv.Itoa(int(r1["id"].(float64)))
	if code, _ := call("POST", "/comments/"+rid+"/report", tok["ada"], `{"reason":"spam"}`); code != 409 {
		t.Errorf("reporting your own comment: %d", code)
	}
	if code, _ := call("POST", "/comments/"+rid+"/report", tok["bo"], `{"reason":"harassment"}`); code != 204 {
		t.Fatalf("report: %d", code)
	}
	if code, _ := call("POST", "/comments/"+rid+"/report", tok["bo"], `{"reason":"harassment"}`); code != 409 {
		t.Errorf("second report: %d", code)
	}
	_, q := call("GET", "/mod/queue", tok["mo"], "")
	if cs := q["comments"].([]any); len(cs) == 0 || strconv.Itoa(int(cs[0].(map[string]any)["id"].(float64))) != rid {
		t.Fatalf("mod queue comments %v", q["comments"])
	}
	if code, _ := call("POST", "/mod/comments/"+rid, tok["mo"], `{"action":"hide"}`); code != 204 {
		t.Fatalf("hide: %d", code)
	}
	if _, l := call("GET", path, "", ""); len(l["items"].([]any)[0].(map[string]any)["replies"].([]any)) != 0 {
		t.Error("hidden reply still public")
	}
	if _, l := call("GET", path, tok["mo"], ""); l["items"].([]any)[0].(map[string]any)["replies"].([]any)[0].(map[string]any)["hidden"] != true {
		t.Error("moderator should see the hidden reply, marked")
	}
}
