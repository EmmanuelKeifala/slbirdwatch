package api

import (
	"math/rand/v2"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
)

// QZ-10 dawn chorus: 2–3 songs of well-recorded Sierra Leone birds played together; tick every bird you hear
// among 6. Rounds get busier: 2 singers for the first two, then 3.

type chorusSong struct {
	quizSound
	SpeciesID int64 `json:"species_id"`
}

type chorusRound struct {
	Songs   []chorusSong `json:"songs"`
	Answer  []quizOption `json:"answer"`  // the singers
	Options []quizOption `json:"options"` // 6, shuffled, singers included
}

// GET /quiz/chorus?n=5 (1–8)
func (a *Server) chorus(w http.ResponseWriter, r *http.Request) {
	n, _ := strconv.Atoi(r.URL.Query().Get("n"))
	if n < 1 || n > 8 {
		n = 5
	}
	// the 150 best-recorded local birds with a quiz-suitable song; one random song each
	rows, err := a.db.Query(r.Context(), `
		SELECT DISTINCT ON (s.id) s.id, s.english_name, s.scientific_name, g.key, g.spec_key, g.credit, g.licence
		FROM (SELECT species_id FROM region_species ORDER BY records DESC LIMIT 150) top
		JOIN species s ON s.id = top.species_id
		JOIN species_sound_gallery g ON g.species_id = s.id AND g.kind = 'song' AND g.quiz_suitable
		ORDER BY s.id, random()`)
	if err != nil {
		internalError(w, "chorus", err)
		return
	}
	type pool struct {
		opt  quizOption
		song quizSound
	}
	birds, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (pool, error) {
		var p pool
		err := row.Scan(&p.opt.ID, &p.opt.EnglishName, &p.opt.ScientificName, &p.song.URL, &p.song.SpectrogramURL, &p.song.Credit, &p.song.Licence)
		return p, err
	})
	if err != nil {
		internalError(w, "chorus", err)
		return
	}
	if len(birds) < 6 {
		writeJSON(w, http.StatusOK, map[string]any{"rounds": []chorusRound{}})
		return
	}
	rounds := make([]chorusRound, 0, n)
	for i := 0; i < n; i++ {
		k := 2
		if i >= 2 {
			k = 3
		}
		rand.Shuffle(len(birds), func(x, y int) { birds[x], birds[y] = birds[y], birds[x] })
		var rd chorusRound
		for _, b := range birds[:k] {
			s := b.song
			s.URL, s.SpectrogramURL = a.media.URL(s.URL), a.media.URL(s.SpectrogramURL)
			rd.Songs = append(rd.Songs, chorusSong{s, b.opt.ID})
			rd.Answer = append(rd.Answer, b.opt)
		}
		for _, b := range birds[:6] {
			rd.Options = append(rd.Options, b.opt)
		}
		rand.Shuffle(len(rd.Options), func(x, y int) { rd.Options[x], rd.Options[y] = rd.Options[y], rd.Options[x] })
		rounds = append(rounds, rd)
	}
	writeJSON(w, http.StatusOK, map[string]any{"rounds": rounds})
}
