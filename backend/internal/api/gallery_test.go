package api

import (
	"strings"
	"testing"
)

func TestPickGallery(t *testing.T) {
	ph := func(id int64, month int) inatPhoto { return inatPhoto{id: id, month: month} }
	male := []inatPhoto{ph(1, 1), ph(2, 2), ph(3, 3)}
	female := []inatPhoto{ph(1, 1), ph(4, 7)} // 1 is also in the male list
	general := []inatPhoto{ph(10, 1), ph(11, 2), ph(12, 3), ph(13, 4), ph(20, 6), ph(21, 8), ph(2, 2)}
	got := pickGallery(male, female, nil, general)
	var ids []int64
	variants := map[int64]string{}
	for _, p := range got {
		ids = append(ids, p.id)
		variants[p.id] = p.variant
	}
	// 2 male, female 4 (1 already used), then dry/wet alternating: 10, 20, 11, 21, 12 → capped at 8.
	want := []int64{1, 2, 4, 10, 20, 11, 21, 12}
	if len(ids) != len(want) {
		t.Fatalf("ids %v, want %v", ids, want)
	}
	for i := range want {
		if ids[i] != want[i] {
			t.Fatalf("ids %v, want %v", ids, want)
		}
	}
	if variants[1] != "male" || variants[4] != "female" || variants[10] != "" {
		t.Errorf("variants %v", variants)
	}
}

func TestVariantAndCredit(t *testing.T) {
	var o inatObservation
	o.Annotations = append(o.Annotations, struct {
		Attr  int `json:"controlled_attribute_id"`
		Value int `json:"controlled_value_id"`
	}{1, 8})
	if v := variantOf(o); v != "juvenile" {
		t.Errorf("variant %q", v)
	}
	for in, want := range map[[3]string]string{
		{"(c) Jane Doe, some rights reserved (CC BY-NC)", "", "jd"}: "Jane Doe",
		{"(c) Doe, Jane, some rights reserved (CC BY)", "", "jd"}:   "Doe, Jane",
		{"no rights reserved", "Jane Doe", "jd"}:                    "Jane Doe",
		{"no rights reserved", "", "jd"}:                            "jd",
	} {
		if got := photoCredit(in[0], in[1], in[2]); got != want {
			t.Errorf("%v: %q, want %q", in, got, want)
		}
	}
}

func TestPickSounds(t *testing.T) {
	cc := "//creativecommons.org/licenses/by-nc-nd/4.0/"
	rec := func(id, typ, cnt, q, date string) xcRec {
		r := xcRec{Cnt: cnt, Date: date}
		r.ID, r.Type, r.Q, r.File, r.Lic = id, typ, q, "f", cc
		return r
	}
	recs := []xcRec{
		rec("1", "song", "Morocco", "A", "2020-04-01"),
		rec("2", "song", "Ghana", "B", "2020-01-10"),        // West Africa beats a better Moroccan recording
		rec("3", "song", "Sierra Leone", "C", "2021-02-01"), // Sierra Leone first
		rec("4", "song", "Senegal", "C", "2019-08-01"),      // other season → chosen second
		rec("5", "alarm call, call", "Gambia", "A", "2019-01-01"),
		rec("6", "call, flight call", "Spain", "A", "2019-01-01"),
		rec("7", "drumming", "Ghana", "A", "2019-01-01"),
		rec("3", "song", "Sierra Leone", "C", "2021-02-01"), // duplicate from the 2nd query
	}
	var got []string
	for _, r := range pickSounds(recs) {
		got = append(got, soundKind(r.Type)+":"+r.ID)
	}
	if want := "song:3 song:4 alarm:5 flight:6"; strings.Join(got, " ") != want {
		t.Fatalf("got %v, want %s", got, want)
	}
}
