package api

import (
	"net/http"
	"strconv"
	"testing"
	"time"
)

func TestEditAndDeleteObservation(t *testing.T) {
	call, email := apiTest(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	token := out["token"].(string)
	_, out = call("POST", "/auth/signup", "", creds("other-"+email, "correct horse", "Bo"))
	other := out["token"].(string)
	t.Cleanup(func() { call("DELETE", "/me", other, `{"password":"correct horse"}`) })

	when := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	body := `{"observed_at":"` + when + `","lat":8.48,"lng":-13.23,"count":2,"notes":"pair","features":{"colours":["black","white"]}}`
	_, o := call("POST", "/observations", token, body)
	id := strconv.Itoa(int(o["id"].(float64)))

	if code, _ := call("PUT", "/observations/"+id, other, body); code != http.StatusNotFound {
		t.Fatalf("other user edit: %d", code)
	}
	if code, _ := call("PUT", "/observations/"+id, token, `{"observed_at":"`+when+`"}`); code != http.StatusBadRequest {
		t.Fatalf("invalid edit: %d", code)
	}
	// Same values, features in another order: no change, no history row.
	same := `{"observed_at":"` + when + `","lat":8.48,"lng":-13.23,"count":2,"notes":"pair","features":{"colours":["black","white"]}}`
	if code, _ := call("PUT", "/observations/"+id, token, same); code != 200 {
		t.Fatalf("no-op edit: %d", code)
	}
	_, h := call("GET", "/observations/"+id+"/history", token, "")
	if n := len(h["items"].([]any)); n != 0 {
		t.Fatalf("no-op edit logged %d changes", n)
	}

	_, crows := call("GET", "/species?q=pied+crow&limit=1", "", "")
	crowID := strconv.Itoa(int(crows["items"].([]any)[0].(map[string]any)["id"].(float64)))
	edited := `{"species_id":` + crowID + `,"confidence":"certain","observed_at":"` + when + `","lat":8.48,"lng":-13.23,"count":3,"notes":"three","features":{"colours":["black","white"]}}`
	code, e := call("PUT", "/observations/"+id, token, edited)
	if code != 200 || e["count"].(float64) != 3 || e["species"].(map[string]any)["english_name"] != "Pied Crow" || e["confidence"] != "certain" {
		t.Fatalf("edit: %d %v", code, e)
	}

	_, h = call("GET", "/observations/"+id+"/history", token, "")
	items := h["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("history: %v", items)
	}
	ch := items[0].(map[string]any)["changes"].(map[string]any)
	if len(ch) != 4 || ch["count"].(map[string]any)["from"].(float64) != 2 || ch["species_id"].(map[string]any)["from"] != nil {
		t.Fatalf("changes: %v", ch)
	}
	if code, _ := call("GET", "/observations/"+id+"/history", other, ""); code != http.StatusNotFound {
		t.Fatalf("other user reads history: %d", code)
	}

	if code, _ := call("DELETE", "/observations/"+id, other, ""); code != http.StatusNotFound {
		t.Fatalf("other user delete: %d", code)
	}
	if code, _ := call("DELETE", "/observations/"+id, token, ""); code != http.StatusNoContent {
		t.Fatalf("delete: %d", code)
	}
	if code, _ := call("GET", "/observations/"+id, token, ""); code != http.StatusNotFound {
		t.Fatalf("deleted observation still readable: %d", code)
	}
}
