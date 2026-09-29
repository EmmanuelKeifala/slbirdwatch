package main

import (
	"strconv"
	"testing"
)

func TestQuizStatsSync(t *testing.T) {
	call, email := apiTest(t)
	_, out := call("POST", "/auth/signup", "", creds(email, "correct horse", "Ada"))
	token := out["token"].(string)

	if _, s := call("GET", "/me/quiz-stats", token, ""); s["quizzes"].(float64) != 0 {
		t.Fatalf("new account: %v", s)
	}
	// A guest's on-phone progress merged at sign-up.
	_, s := call("POST", "/me/quiz-stats", token, `{"quizzes":3,"answered":30,"correct":21,"bestStreak":6,"missed":{"12":2,"34":1}}`)
	if s["quizzes"].(float64) != 3 || s["correct"].(float64) != 21 || s["missed"].(map[string]any)["12"].(float64) != 2 {
		t.Fatalf("after guest merge: %v", s)
	}
	// Then one quiz: bird 34 answered right (-1 → gone), bird 56 wrong; a shorter streak keeps the best.
	_, s = call("POST", "/me/quiz-stats", token, `{"quizzes":1,"answered":10,"correct":7,"bestStreak":4,"missed":{"34":-1,"56":1,"x":5}}`)
	m := s["missed"].(map[string]any)
	if s["quizzes"].(float64) != 4 || s["answered"].(float64) != 40 || s["bestStreak"].(float64) != 6 || m["34"] != nil || m["56"].(float64) != 1 || m["x"] != nil {
		t.Fatalf("after quiz: %v", s)
	}
	// Per-bird and per-kind results add up (LRN-06).
	call("POST", "/me/quiz-stats", token, `{"quizzes":1,"answered":2,"correct":1,"bySpecies":{"12":[1,0],"99":[0,1]},"byKind":{"sound":[1,1],"smell":[5,5]}}`)
	_, s = call("POST", "/me/quiz-stats", token, `{"quizzes":1,"answered":1,"correct":1,"bySpecies":{"12":[1,0]},"byKind":{"sound":[1,0]}}`)
	if bs := s["bySpecies"].(map[string]any)["12"].([]any); bs[0].(float64) != 2 || bs[1].(float64) != 0 {
		t.Errorf("bySpecies %v", s["bySpecies"])
	}
	if bk := s["byKind"].(map[string]any); bk["sound"].([]any)[0].(float64) != 2 || bk["smell"] != nil {
		t.Errorf("byKind %v", bk)
	}
	for _, bad := range []string{`{"answered":5,"correct":6}`, `{"quizzes":-1}`, `{"answered":2,"bestStreak":3}`, `nope`} {
		if code, _ := call("POST", "/me/quiz-stats", token, bad); code != 400 {
			t.Errorf("%s: %d", bad, code)
		}
	}
	if code, _ := call("GET", "/me/quiz-stats", "", ""); code != 401 {
		t.Errorf("guest: %d", code)
	}
}

func TestMergeQuizStatsCap(t *testing.T) {
	d := quizStats{Missed: map[string]int{}}
	for i := range 350 {
		d.Missed[strconv.Itoa(i)] = i + 1
	}
	out := mergeQuizStats(quizStats{}, d)
	if _, kept := out.Missed["0"]; len(out.Missed) != maxMissed || kept || out.Missed["349"] != 350 { // least-missed dropped
		t.Fatalf("cap kept %d, least-missed %d", len(out.Missed), out.Missed["0"])
	}
}
