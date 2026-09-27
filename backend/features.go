package main

import (
	"fmt"
	"net/http"
	"slices"
)

// OBS-05 structured ID features. This vocabulary is the single source of truth: the API validates
// against it and serves it to the app (GET /features), so labels and allowed values never drift.
type option struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

type featureField struct {
	Key     string   `json:"key"`
	Label   string   `json:"label"`
	Multi   bool     `json:"multi"`
	Options []option `json:"options"`
}

var featureFields = []featureField{
	{"size", "Size", false, []option{
		{"tiny", "Tiny (smaller than a sparrow)"}, {"small", "Small (sparrow to thrush)"},
		{"medium", "Medium (pigeon to crow)"}, {"large", "Large (duck to goose)"}, {"very_large", "Very large (heron, eagle and up)"},
	}},
	{"colours", "Main colours", true, []option{
		{"black", "Black"}, {"white", "White"}, {"grey", "Grey"}, {"brown", "Brown"}, {"buff", "Buff"},
		{"red", "Red"}, {"orange", "Orange"}, {"yellow", "Yellow"}, {"green", "Green"}, {"blue", "Blue"},
		{"purple", "Purple"}, {"pink", "Pink"}, {"iridescent", "Iridescent"},
	}},
	{"bill", "Bill shape", false, []option{
		{"conical", "Short and conical"}, {"thin", "Thin and pointed"}, {"hooked", "Hooked"},
		{"long_straight", "Long and straight"}, {"long_curved", "Long and curved"}, {"flat", "Flat or broad"},
		{"casque", "Large with casque"}, {"other", "Other"},
	}},
	{"markings", "Markings", true, []option{
		{"eye_ring", "Eye-ring"}, {"eyebrow", "Eyebrow stripe"}, {"eye_stripe", "Eye stripe"}, {"crest", "Crest"},
		{"cap", "Contrasting cap"}, {"throat_patch", "Throat patch"}, {"wing_bars", "Wing bars"},
		{"streaked", "Streaked"}, {"spotted", "Spotted"}, {"barred", "Barred"}, {"long_tail", "Long tail or streamers"},
	}},
	{"behaviour", "Behaviour", true, []option{
		{"perched", "Perched"}, {"ground", "Foraging on the ground"}, {"canopy", "Foraging in trees"},
		{"flying", "Flying"}, {"soaring", "Soaring"}, {"hovering", "Hovering"}, {"swimming", "Swimming"},
		{"wading", "Wading"}, {"diving", "Diving"}, {"singing", "Singing or calling"}, {"flocking", "In a flock"},
		{"nesting", "Nesting or feeding young"},
	}},
	{"habitat", "Habitat", false, []option{
		{"forest", "Forest"}, {"woodland", "Woodland or scrub"}, {"grassland", "Grassland or savanna"},
		{"wetland", "Wetland or marsh"}, {"mangrove", "Mangrove"}, {"coast", "Coast or beach"},
		{"open_water", "Open water"}, {"farmland", "Farmland"}, {"urban", "Town or garden"}, {"mountain", "Mountain"},
	}},
	{"sex", "Sex", false, []option{{"male", "Male"}, {"female", "Female"}}},
	{"age", "Age", false, []option{{"adult", "Adult"}, {"immature", "Immature"}, {"juvenile", "Juvenile"}}},
	{"plumage", "Plumage", false, []option{{"breeding", "Breeding"}, {"non_breeding", "Non-breeding"}, {"moulting", "Moulting"}}},
}

// features is what's stored (observations.features jsonb): single fields hold a string, multi fields a string list.
type features map[string]any

// validateFeatures checks keys, value types and allowed values, drops empty entries, and dedupes lists.
func validateFeatures(in map[string]any) (features, error) {
	out := features{}
	for k, v := range in {
		i := slices.IndexFunc(featureFields, func(f featureField) bool { return f.Key == k })
		if i < 0 {
			return nil, fmt.Errorf("unknown feature %q", k)
		}
		f := featureFields[i]
		allowed := func(s string) bool {
			return slices.ContainsFunc(f.Options, func(o option) bool { return o.Value == s })
		}
		if !f.Multi {
			if v == nil || v == "" {
				continue
			}
			s, ok := v.(string)
			if !ok || !allowed(s) {
				return nil, fmt.Errorf("%s: %v is not an allowed value", f.Key, v)
			}
			out[k] = s
			continue
		}
		list, ok := v.([]any)
		if !ok {
			if v == nil {
				continue
			}
			return nil, fmt.Errorf("%s must be a list", f.Key)
		}
		var vals []string
		for _, item := range list {
			s, ok := item.(string)
			if !ok || !allowed(s) {
				return nil, fmt.Errorf("%s: %v is not an allowed value", f.Key, item)
			}
			if !slices.Contains(vals, s) {
				vals = append(vals, s)
			}
		}
		if len(vals) > 0 {
			out[k] = vals
		}
	}
	return out, nil
}

// GET /features — public vocabulary for the upload form.
func listFeatures(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "public, max-age=3600")
	writeJSON(w, http.StatusOK, featureFields)
}
