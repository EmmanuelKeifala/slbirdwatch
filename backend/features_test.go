package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestValidateFeatures(t *testing.T) {
	parse := func(s string) map[string]any {
		var m map[string]any
		if err := json.Unmarshal([]byte(s), &m); err != nil {
			t.Fatal(err)
		}
		return m
	}
	got, err := validateFeatures(parse(`{"size":"small","colours":["red","black","red"],"bill":"","markings":[],"sex":null}`))
	if err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(got) != "map[colours:[red black] size:small]" {
		t.Fatalf("normalised: %v", got)
	}
	for _, bad := range []string{
		`{"wingspan":"big"}`,          // unknown key
		`{"size":"huge"}`,             // not an option
		`{"size":5}`,                  // wrong type on a single field
		`{"colours":"red"}`,           // multi field needs a list
		`{"colours":["red","plaid"]}`, // bad list item
		`{"colours":[1]}`,
	} {
		if _, err := validateFeatures(parse(bad)); err == nil {
			t.Errorf("%s: accepted", bad)
		}
	}
	if got, err := validateFeatures(nil); err != nil || len(got) != 0 {
		t.Fatalf("nil features: %v %v", got, err)
	}
}

func TestObservationFeaturesAPI(t *testing.T) {
	call, email := apiTest(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	token := out["token"].(string)

	rec := httptest.NewRecorder()
	testRouter(t).ServeHTTP(rec, httptest.NewRequest("GET", "/features", nil))
	var vocab []featureField
	json.NewDecoder(rec.Body).Decode(&vocab)
	if rec.Code != 200 || len(vocab) != len(featureFields) || len(vocab[0].Options) == 0 {
		t.Fatalf("GET /features: %d, %d fields", rec.Code, len(vocab))
	}

	base := `"observed_at":"` + time.Now().UTC().Format(time.RFC3339) + `","lat":8.48,"lng":-13.23`
	if code, _ := call("POST", "/observations", token, `{`+base+`,"features":{"size":"huge"}}`); code != http.StatusBadRequest {
		t.Fatalf("bad feature accepted: %d", code)
	}
	code, o := call("POST", "/observations", token, `{`+base+`,"features":{"size":"medium","colours":["black","white"],"habitat":"urban"}}`)
	f, _ := o["features"].(map[string]any)
	if code != http.StatusCreated || f["size"] != "medium" || fmt.Sprint(f["colours"]) != "[black white]" || f["habitat"] != "urban" {
		t.Fatalf("create with features: %d %v", code, o)
	}
	_, o = call("POST", "/observations", token, `{`+base+`}`)
	if f, ok := o["features"].(map[string]any); !ok || len(f) != 0 {
		t.Fatalf("default features: %v", o["features"])
	}
}

func TestModelServed(t *testing.T) {
	rec := httptest.NewRecorder()
	routes(nil, nil, nil).ServeHTTP(rec, httptest.NewRequest("GET", "/models/pigeon.glb", nil))
	if rec.Code != http.StatusOK || rec.Body.Len() < 1e5 || rec.Body.String()[:4] != "glTF" {
		t.Fatalf("GET /models/pigeon.glb: %d, %d bytes", rec.Code, rec.Body.Len())
	}
}
