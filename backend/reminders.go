package main

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// NTF-02: pushes for new weekly challenges (Monday from 08:00) and streak reminders: the daily quiz streak
// (from 18:00, when you quizzed yesterday but not yet today and the run is 2+ days) and the weekly outing
// (Saturday from 09:00, when you went out last week but not yet this week). Times are UTC = Sierra Leone.
// Only for people with a phone registered and reminders switched on; reminders_sent keeps each to once.

func (a *server) remindersLoop(ctx context.Context) {
	t := time.NewTicker(15 * time.Minute)
	defer t.Stop()
	for {
		if err := a.runReminders(ctx, time.Now().UTC()); err != nil {
			log.Printf("reminders: %v", err)
		}
		if err := a.flushRarePushes(ctx); err != nil { // COM-04 / NTF-03
			log.Printf("rare alerts: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

type reminder struct {
	userID      int64
	title, body string
	url         string // where a tap opens in the app
}

func (a *server) runReminders(ctx context.Context, now time.Time) error {
	today, wk := day(now), week(now)
	var out []reminder

	if now.Weekday() == time.Monday && now.Hour() >= 8 {
		if err := a.ensureWeek(ctx, wk); err != nil {
			return err
		}
		rows, err := a.db.Query(ctx, `SELECT title FROM challenges WHERE week = $1 ORDER BY slot`, wk)
		if err != nil {
			return err
		}
		titles, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return err
		}
		ids, err := a.claim(ctx, "challenges", wk, `SELECT u.id FROM users u WHERE u.notify_reminders
			AND EXISTS (SELECT 1 FROM push_tokens p WHERE p.user_id = u.id)`)
		if err != nil {
			return err
		}
		for _, id := range ids {
			out = append(out, reminder{id, "New weekly challenges", strings.Join(titles, " · "), "/learn"})
		}
	}

	if now.Hour() >= 18 {
		ids, err := a.claim(ctx, "quiz_streak", today, `SELECT u.id FROM users u WHERE u.notify_reminders
			AND EXISTS (SELECT 1 FROM push_tokens p WHERE p.user_id = u.id)
			AND EXISTS (SELECT 1 FROM quiz_days q WHERE q.user_id = u.id AND q.day = $1::date - 1)
			AND EXISTS (SELECT 1 FROM quiz_days q WHERE q.user_id = u.id AND q.day = $1::date - 2)
			AND NOT EXISTS (SELECT 1 FROM quiz_days q WHERE q.user_id = u.id AND q.day = $1::date)`)
		if err != nil {
			return err
		}
		for _, id := range ids {
			_, streaks, err := a.loadAchievements(ctx, id, now)
			if err != nil {
				return err
			}
			n := streaks["daily_quiz"].Current
			out = append(out, reminder{id, fmt.Sprintf("Keep your %d-day quiz streak", n), "A quick quiz today keeps it going.", "/quiz"})
		}
	}

	if now.Weekday() == time.Saturday && now.Hour() >= 9 {
		ids, err := a.claim(ctx, "outing_streak", wk, `SELECT u.id FROM users u WHERE u.notify_reminders
			AND EXISTS (SELECT 1 FROM push_tokens p WHERE p.user_id = u.id)
			AND EXISTS (SELECT 1 FROM outings o WHERE o.user_id = u.id AND o.started_at >= $1::date - 7 AND o.started_at < $1::date)
			AND NOT EXISTS (SELECT 1 FROM outings o WHERE o.user_id = u.id AND o.started_at >= $1::date)`)
		if err != nil {
			return err
		}
		for _, id := range ids {
			_, streaks, err := a.loadAchievements(ctx, id, now)
			if err != nil {
				return err
			}
			n := streaks["weekly_outing"].Current
			out = append(out, reminder{id, "Time for a walk?", fmt.Sprintf("You’ve been out %d week%s in a row. Log an outing this weekend to keep it going.", n, map[bool]string{true: "", false: "s"}[n == 1]), "/"})
		}
	}
	// GAM-06: from 07:00 on the day an event starts
	if now.Hour() >= 7 {
		rows, err := a.db.Query(ctx, `SELECT slug, title, starts_at FROM events WHERE starts_at::date = $1::date`, today)
		if err != nil {
			return err
		}
		type ev struct {
			slug, title string
			start       time.Time
		}
		var evs []ev
		var e ev
		if _, err := pgx.ForEachRow(rows, []any{&e.slug, &e.title, &e.start}, func() error { evs = append(evs, e); return nil }); err != nil {
			return err
		}
		for _, e := range evs {
			ids, err := a.claim(ctx, "event", e.start, `SELECT u.id FROM users u WHERE u.notify_reminders
				AND EXISTS (SELECT 1 FROM push_tokens p WHERE p.user_id = u.id)`)
			if err != nil {
				return err
			}
			for _, id := range ids {
				out = append(out, reminder{id, e.title + " starts today", "Log every species you see and add to Sierra Leone's count.", "/event/" + e.slug})
			}
		}
	}
	return a.sendReminders(ctx, out)
}

// claim records the reminder for everyone `who` returns ($1 = the day/week key) and gives back only those it
// was newly recorded for, so a second run (or another instance) sends nothing twice.
func (a *server) claim(ctx context.Context, kind string, key time.Time, who string) ([]int64, error) {
	rows, err := a.db.Query(ctx, `INSERT INTO reminders_sent (user_id, kind, key)
		SELECT id, $2, $1 FROM (`+who+`) w ON CONFLICT DO NOTHING RETURNING user_id`, key, kind)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[int64])
}

func (a *server) sendReminders(ctx context.Context, rs []reminder) error {
	var msgs []pushMessage
	for _, r := range rs {
		rows, err := a.db.Query(ctx, `SELECT token FROM push_tokens WHERE user_id = $1`, r.userID)
		if err != nil {
			return err
		}
		tokens, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return err
		}
		for _, t := range tokens {
			msgs = append(msgs, pushMessage{To: t, Title: r.title, Body: r.body, Sound: "default", ChannelID: "default", Data: map[string]any{"url": r.url}})
		}
	}
	if len(msgs) == 0 {
		return nil
	}
	return a.postPushes(ctx, msgs)
}
