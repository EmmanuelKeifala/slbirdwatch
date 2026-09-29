package main

import (
	"strconv"
	"testing"
)

func TestLessons(t *testing.T) {
	call, _ := apiTest(t)
	_, list := call("GET", "/lessons", "", "")
	items := list["items"].([]any)
	if len(items) < 5 || items[0].(map[string]any)["slug"] != "common" {
		t.Fatalf("lessons %v", items)
	}
	_, l := call("GET", "/lessons/sunbirds", "", "")
	birds := l["birds"].([]any)
	if len(birds) == 0 || len(birds) > 8 {
		t.Fatalf("sunbird lesson has %d birds", len(birds))
	}
	var ids []string
	for _, b := range birds {
		m := b.(map[string]any)
		if m["family_en"] != "Sunbirds" {
			t.Errorf("not a sunbird: %v", m["english_name"])
		}
		ids = append(ids, strconv.Itoa(int(m["id"].(float64))))
	}
	if code, _ := call("GET", "/lessons/nope", "", ""); code != 404 {
		t.Errorf("unknown lesson: %d", code)
	}
	// The lesson's quiz asks only about its birds.
	allowed := map[string]bool{}
	q := ""
	for _, id := range ids {
		allowed[id] = true
		q += id + ","
	}
	_, quiz := call("GET", "/quiz/picture?n=20&species="+q, "", "")
	for _, qq := range quiz["questions"].([]any) {
		id := strconv.Itoa(int(qq.(map[string]any)["answer"].(map[string]any)["id"].(float64)))
		if !allowed[id] {
			t.Errorf("quiz asked about %s, not in the lesson", id)
		}
	}
}

func TestFlashcardData(t *testing.T) {
	call, _ := apiTest(t)
	_, sp := call("GET", "/species?q=pied+crow&limit=1", "", "")
	crow := strconv.Itoa(int(sp["items"].([]any)[0].(map[string]any)["id"].(float64)))
	_, pen := call("GET", "/species?q=emperor+penguin&limit=1", "", "")
	penguin := strconv.Itoa(int(pen["items"].([]any)[0].(map[string]any)["id"].(float64)))
	_, res := call("GET", "/species/cards?ids="+crow+","+penguin+",999999999", "", "")
	items := res["items"].([]any)
	if len(items) != 2 { // a bird outside Sierra Leone works too; an unknown id is skipped
		t.Fatalf("cards %d", len(items))
	}
	if first := items[0].(map[string]any); first["english_name"] != "Pied Crow" || first["image"] == nil {
		t.Errorf("crow card %v", first)
	}
}
