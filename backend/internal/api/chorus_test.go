package api

import "testing"

func TestChorus(t *testing.T) {
	call, _ := apiTest(t)
	_, v := call("GET", "/quiz/chorus?n=4", "", "")
	rounds := v["rounds"].([]any)
	if len(rounds) == 0 {
		t.Skip("no seeded songs")
	}
	for i, r := range rounds {
		m := r.(map[string]any)
		songs, answer, options := m["songs"].([]any), m["answer"].([]any), m["options"].([]any)
		want := 2
		if i >= 2 {
			want = 3
		}
		if len(songs) != want || len(answer) != want || len(options) != 6 {
			t.Fatalf("round %d: %d songs, %d answers, %d options", i, len(songs), len(answer), len(options))
		}
		in := map[float64]bool{}
		for _, o := range options {
			in[o.(map[string]any)["id"].(float64)] = true
		}
		seen := map[float64]bool{}
		for j, s := range songs {
			id := s.(map[string]any)["species_id"].(float64)
			if !in[id] || seen[id] || answer[j].(map[string]any)["id"].(float64) != id || s.(map[string]any)["url"] == "" {
				t.Fatalf("round %d song %d: %v", i, j, s)
			}
			seen[id] = true
		}
	}
}
