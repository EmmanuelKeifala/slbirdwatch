package main

import (
	"context"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
)

// ADM-06: the KPIs from BRD §2.2, worked out from the database on request (admins only).
// ponytail: plain queries over all rows; precompute nightly if the tables get big.

type weekCount struct {
	Week  time.Time `json:"week"`
	Count int       `json:"count"`
}

type analytics struct {
	Library struct {
		Species    int `json:"species"`     // Sierra Leone species in the library
		WithPhoto  int `json:"with_photo"`  // with a main photo
		Photos3Pct int `json:"photos3_pct"` // % with ≥3 trusted photos (gallery + verified sightings)
		CallPct    int `json:"call_pct"`    // % with ≥1 trusted recording
		Lessons    int `json:"lessons"`     // published
		ExpertTips int `json:"expert_tips"` // LIB-10
		Reference  int `json:"reference"`   // reference photos (VER-07)
	} `json:"library"`
	Contribution struct {
		UploadsPerWeek []weekCount `json:"uploads_per_week"` // last 8 weeks, oldest first
		ReachedPct     int         `json:"reached_pct"`      // uploads 7–97 days old with community ID or verified
		Verified       int         `json:"verified"`         // verified sightings, all time
	} `json:"contribution"`
	Learning struct {
		QuizzesPerWeek   []weekCount `json:"quizzes_per_week"`
		ImprovementPts   *int        `json:"improvement_pts"`   // median accuracy change, first week vs week 5+ (points)
		ImprovementUsers int         `json:"improvement_users"` // people with that much quiz history
	} `json:"learning"`
	Engagement struct {
		DAU             int  `json:"dau"`
		MAU             int  `json:"mau"`
		DAUMAUPct       int  `json:"dau_mau_pct"`
		D7Pct           *int `json:"d7_pct"`           // signed up 8–60 days ago, back on days 7–13
		D30Pct          *int `json:"d30_pct"`          // signed up 31–90 days ago, back on days 30–36
		ChallengeActive int  `json:"challenge_active"` // last week: active people with progress on a challenge
		ChallengeDone   int  `json:"challenge_done"`   // challenges completed last week
		ChallengeOf     int  `json:"challenge_of"`     // people active last week
	} `json:"engagement"`
	Reach struct {
		AnonToday int            `json:"anon_today"` // bird pages opened without signing in
		Anon7Days int            `json:"anon_7_days"`
		Accounts  int            `json:"accounts"`
		NewWeek   int            `json:"new_week"`
		Devices   map[string]int `json:"devices"` // phones registered for notifications, by platform
	} `json:"reach"`
	Quality struct {
		FirstIDHours    *float64 `json:"first_id_hours"`   // median, uploads in the last 90 days
		ResolutionHours *float64 `json:"resolution_hours"` // median, reports closed in the last 90 days
		OpenReports     int      `json:"open_reports"`
		AwaitingID      int      `json:"awaiting_id"`
	} `json:"quality"`
}

func pct(n, of int) int {
	if of == 0 {
		return 0
	}
	return 100 * n / of
}

func (a *server) weekly(ctx context.Context, sql string, from time.Time) ([]weekCount, error) {
	rows, err := a.db.Query(ctx, `SELECT w::date, coalesce(x.n, 0)::int FROM generate_series($1::date, $1::date + 49, '7 days') w
		LEFT JOIN (`+sql+`) x ON x.wk = w::date ORDER BY 1`, from)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (weekCount, error) {
		var c weekCount
		return c, row.Scan(&c.Week, &c.Count)
	})
}

func (a *server) loadAnalytics(ctx context.Context, now time.Time) (analytics, error) {
	var an analytics
	from := week(now).AddDate(0, 0, -49) // 8 weeks, this one last
	L, C, E, R, Q := &an.Library, &an.Contribution, &an.Engagement, &an.Reach, &an.Quality

	err := a.db.QueryRow(ctx, `
		WITH sl AS (SELECT species_id FROM region_species),
		     photos AS (SELECT species_id, count(*) AS n FROM (
		         SELECT species_id FROM species_gallery UNION ALL
		         SELECT o.community_species_id FROM media m JOIN observations o ON o.id = m.observation_id
		         WHERE m.kind = 'photo' AND o.status = 'verified' AND NOT o.hidden) p GROUP BY 1),
		     calls AS (SELECT species_id FROM species_sound_gallery UNION SELECT species_id FROM species_sounds WHERE status = 'ok'
		         UNION SELECT o.community_species_id FROM media m JOIN observations o ON o.id = m.observation_id
		         WHERE m.kind = 'sound' AND o.status = 'verified' AND NOT o.hidden)
		SELECT (SELECT count(*) FROM sl)::int,
		       (SELECT count(*) FROM sl WHERE species_id IN (SELECT species_id FROM species_images WHERE status = 'ok')
		           OR species_id IN (SELECT species_id FROM species_gallery))::int,
		       (SELECT count(*) FROM sl JOIN photos USING (species_id) WHERE n >= 3)::int,
		       (SELECT count(*) FROM sl WHERE species_id IN (SELECT species_id FROM calls))::int,
		       (SELECT count(*) FROM lessons WHERE published)::int,
		       (SELECT count(*) FROM id_tips)::int,
		       (SELECT count(*) FROM media WHERE reference)::int + (SELECT count(*) FROM species_gallery WHERE reference)::int`).
		Scan(&L.Species, &L.WithPhoto, &L.Photos3Pct, &L.CallPct, &L.Lessons, &L.ExpertTips, &L.Reference)
	if err != nil {
		return an, err
	}
	L.Photos3Pct, L.CallPct = pct(L.Photos3Pct, L.Species), pct(L.CallPct, L.Species)

	if C.UploadsPerWeek, err = a.weekly(ctx, `SELECT date_trunc('week', created_at)::date AS wk, count(*) AS n FROM observations GROUP BY 1`, from); err != nil {
		return an, err
	}
	var reached, uploads int
	if err := a.db.QueryRow(ctx, `SELECT count(*) FILTER (WHERE status IN ('community', 'verified'))::int, count(*)::int,
		(SELECT count(*) FROM observations WHERE status = 'verified')::int
		FROM observations WHERE created_at BETWEEN now() - interval '97 days' AND now() - interval '7 days'`).Scan(&reached, &uploads, &C.Verified); err != nil {
		return an, err
	}
	C.ReachedPct = pct(reached, uploads)

	if an.Learning.QuizzesPerWeek, err = a.weekly(ctx, `SELECT date_trunc('week', day)::date AS wk, sum(quizzes) AS n FROM quiz_days GROUP BY 1`, from); err != nil {
		return an, err
	}
	// accuracy in someone's first quiz week vs from their fifth week on (only days with answer counts)
	var imp *float64
	if err := a.db.QueryRow(ctx, `
		WITH f AS (SELECT user_id, min(day) AS d0 FROM quiz_days WHERE answered > 0 GROUP BY 1),
		     acc AS (SELECT q.user_id,
		                    sum(q.correct) FILTER (WHERE q.day < f.d0 + 7)::float / nullif(sum(q.answered) FILTER (WHERE q.day < f.d0 + 7), 0) AS early,
		                    sum(q.correct) FILTER (WHERE q.day >= f.d0 + 28)::float / nullif(sum(q.answered) FILTER (WHERE q.day >= f.d0 + 28), 0) AS late
		             FROM quiz_days q JOIN f USING (user_id) WHERE q.answered > 0 GROUP BY 1)
		SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (late - early) * 100), count(*)::int
		FROM acc WHERE early IS NOT NULL AND late IS NOT NULL`).Scan(&imp, &an.Learning.ImprovementUsers); err != nil {
		return an, err
	}
	if imp != nil {
		v := int(*imp)
		an.Learning.ImprovementPts = &v
	}

	var d7, d7of, d30, d30of int
	if err := a.db.QueryRow(ctx, `
		SELECT (SELECT count(DISTINCT user_id) FROM user_days WHERE day = current_date)::int,
		       (SELECT count(DISTINCT user_id) FROM user_days WHERE day > current_date - 30)::int,
		       (SELECT count(*) FILTER (WHERE EXISTS (SELECT 1 FROM user_days d WHERE d.user_id = u.id
		            AND d.day BETWEEN u.created_at::date + 7 AND u.created_at::date + 13)) FROM users u
		        WHERE u.created_at BETWEEN now() - interval '60 days' AND now() - interval '14 days')::int,
		       (SELECT count(*) FROM users WHERE created_at BETWEEN now() - interval '60 days' AND now() - interval '14 days')::int,
		       (SELECT count(*) FILTER (WHERE EXISTS (SELECT 1 FROM user_days d WHERE d.user_id = u.id
		            AND d.day BETWEEN u.created_at::date + 30 AND u.created_at::date + 36)) FROM users u
		        WHERE u.created_at BETWEEN now() - interval '90 days' AND now() - interval '37 days')::int,
		       (SELECT count(*) FROM users WHERE created_at BETWEEN now() - interval '90 days' AND now() - interval '37 days')::int`).
		Scan(&E.DAU, &E.MAU, &d7, &d7of, &d30, &d30of); err != nil {
		return an, err
	}
	E.DAUMAUPct = pct(E.DAU, E.MAU)
	if d7of > 0 {
		v := pct(d7, d7of)
		E.D7Pct = &v
	}
	if d30of > 0 {
		v := pct(d30, d30of)
		E.D30Pct = &v
	}
	// last week's challenges: of the people active that week, who made progress, and how many were finished
	// ponytail: measures each active person against each challenge (3 × people); fine for a pilot.
	last := week(now).AddDate(0, 0, -7)
	rows, err := a.db.Query(ctx, `SELECT id, week, kind, param, title, description, goal FROM challenges WHERE week = $1`, last)
	if err != nil {
		return an, err
	}
	chs, err := pgx.CollectRows(rows, scanChallenge)
	if err != nil {
		return an, err
	}
	rows, err = a.db.Query(ctx, `SELECT DISTINCT user_id FROM user_days WHERE day >= $1 AND day < $1::date + 7 LIMIT 5000`, last)
	if err != nil {
		return an, err
	}
	people, err := pgx.CollectRows(rows, pgx.RowTo[int64])
	if err != nil {
		return an, err
	}
	E.ChallengeOf = len(people)
	for _, uid := range people {
		tried := false
		for _, ch := range chs {
			n, err := challengeProgress(ctx, a.db, uid, ch)
			if err != nil {
				return an, err
			}
			tried = tried || n > 0
			if n >= ch.Goal {
				E.ChallengeDone++
			}
		}
		if tried {
			E.ChallengeActive++
		}
	}

	R.Devices = map[string]int{}
	if err := a.db.QueryRow(ctx, `SELECT count(*)::int, count(*) FILTER (WHERE created_at > now() - interval '7 days')::int FROM users`).
		Scan(&R.Accounts, &R.NewWeek); err != nil {
		return an, err
	}
	rows, err = a.db.Query(ctx, `SELECT coalesce(nullif(platform, ''), 'unknown'), count(*)::int FROM push_tokens GROUP BY 1`)
	if err != nil {
		return an, err
	}
	var p string
	var n int
	if _, err := pgx.ForEachRow(rows, []any{&p, &n}, func() error { R.Devices[p] = n; return nil }); err != nil {
		return an, err
	}
	for i := 0; i < 7; i++ {
		v, _ := a.cache.Get(ctx, "visits:anon:"+now.AddDate(0, 0, -i).Format("2006-01-02")).Int()
		if i == 0 {
			R.AnonToday = v
		}
		R.Anon7Days += v
	}

	err = a.db.QueryRow(ctx, `
		SELECT (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM first - o.created_at) / 3600)
		        FROM observations o JOIN LATERAL (SELECT min(i.created_at) AS first FROM identifications i
		             WHERE i.observation_id = o.id AND i.user_id <> o.user_id) f ON f.first IS NOT NULL
		        WHERE o.created_at > now() - interval '90 days'),
		       (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM closed_at - created_at) / 3600) FROM (
		            SELECT created_at, closed_at FROM flags UNION ALL SELECT created_at, closed_at FROM user_reports
		            UNION ALL SELECT created_at, closed_at FROM comment_reports) x WHERE closed_at > now() - interval '90 days'),
		       (SELECT count(*) FROM flags WHERE status = 'open')::int + (SELECT count(*) FROM user_reports WHERE status = 'open')::int
		           + (SELECT count(*) FROM comment_reports WHERE status = 'open')::int,
		       (SELECT count(*) FROM observations WHERE status = 'needs_id' AND NOT hidden)::int`).
		Scan(&Q.FirstIDHours, &Q.ResolutionHours, &Q.OpenReports, &Q.AwaitingID)
	return an, err
}

// GET /admin/analytics
func (a *server) adminAnalytics(w http.ResponseWriter, r *http.Request) {
	an, err := a.loadAnalytics(r.Context(), time.Now().UTC())
	if err != nil {
		internalError(w, "analytics", err)
		return
	}
	writeJSON(w, http.StatusOK, an)
}
