-- GAM-06 seasonal events (migration season, Global Big Day tie-ins): a time window in which the community
-- counts species together. Admins add more through the API.
CREATE TABLE events (
    slug        text PRIMARY KEY CHECK (slug ~ '^[a-z0-9-]{2,40}$'),
    title       text NOT NULL CHECK (length(title) BETWEEN 2 AND 80),
    description text NOT NULL DEFAULT '' CHECK (length(description) <= 500),
    starts_at   timestamptz NOT NULL,
    ends_at     timestamptz NOT NULL CHECK (ends_at > starts_at)
);
ALTER TABLE reminders_sent DROP CONSTRAINT reminders_sent_kind_check;
ALTER TABLE reminders_sent ADD CONSTRAINT reminders_sent_kind_check CHECK (kind IN ('challenges', 'quiz_streak', 'outing_streak', 'event'));
INSERT INTO events (slug, title, description, starts_at, ends_at) VALUES
    ('october-big-day-2026', 'October Big Day', 'One day, the whole world birding. Log every species you see on Saturday 10 October and help put Sierra Leone on the global count (eBird''s October Big Day).', '2026-10-10 00:00Z', '2026-10-11 00:00Z'),
    ('migrants-arrive-2026', 'Migrants arrive', 'Palearctic migrants reach Sierra Leone from October: waders on the coast, harriers, wagtails, swallows. Log them as they come in.', '2026-10-01 00:00Z', '2026-12-01 00:00Z'),
    ('global-big-day-2027', 'Global Big Day', 'The biggest birding day of the year. Log every species you see on Saturday 8 May (eBird''s Global Big Day).', '2027-05-08 00:00Z', '2027-05-09 00:00Z');
