package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLicenceName(t *testing.T) {
	cases := map[string]string{
		"https://creativecommons.org/licenses/by-nc-nd/4.0/": "CC BY-NC-ND 4.0",
		"//creativecommons.org/licenses/by-sa/3.0/":          "CC BY-SA 3.0",
		"https://creativecommons.org/publicdomain/zero/1.0/": "CC0",
		"https://example.com/all-rights-reserved":            "",
		"https://creativecommons.org/licenses/":              "",
	}
	for in, want := range cases {
		if got := licenceName(in); got != want {
			t.Errorf("licenceName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestXenoBest(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if strings.Contains(q.Get("query"), "sp:nobird") {
			json.NewEncoder(w).Encode(map[string]any{"recordings": []any{}}) // neither A nor B
			return
		}
		if q.Get("key") != "k" || !strings.Contains(q.Get("query"), "gen:corvus sp:albus q:A len:5-60") {
			w.WriteHeader(400)
			json.NewEncoder(w).Encode(map[string]string{"message": "bad query " + q.Get("query")})
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"recordings": []map[string]string{
			{"id": "1", "type": "call", "lic": "https://creativecommons.org/licenses/by-nc/4.0/", "file": "f1", "rec": "A"},
			{"id": "2", "type": "song", "lic": "https://example.com/nope", "file": "f2", "rec": "B"}, // not CC: skipped
			{"id": "3", "type": "song, call", "lic": "https://creativecommons.org/licenses/by/4.0/", "file": "f3", "rec": "C"},
		}})
	}))
	defer srv.Close()
	xc := &xenoClient{http: srv.Client(), key: "k", base: srv.URL, ua: "SLBirdwatch/test"}
	rec, err := xc.best(context.Background(), "Corvus", "albus")
	if err != nil || rec == nil || rec.ID != "3" {
		t.Fatalf("best = %+v, %v (want the CC-licensed song)", rec, err)
	}
	if rec, err := xc.best(context.Background(), "Corvus", "nobird"); err != nil || rec != nil {
		t.Fatalf("no recordings: %+v %v", rec, err)
	}
	xc.key = "wrong"
	if _, err := xc.best(context.Background(), "Corvus", "albus"); err == nil {
		t.Fatal("API error not surfaced")
	}
}
