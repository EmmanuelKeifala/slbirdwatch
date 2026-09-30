-- ADM-06 analytics: what the KPIs in BRD §2.2 need that wasn't kept yet.
-- Quizzes and answers per day (quiz_days already has right answers), for quizzes per week and accuracy over time.
ALTER TABLE quiz_days ADD COLUMN quizzes integer NOT NULL DEFAULT 0, ADD COLUMN answered integer NOT NULL DEFAULT 0;
-- Days each person used the app while signed in (DAU/MAU, retention). Backfilled from uploads and quiz days.
CREATE TABLE user_days (
    user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    day     date NOT NULL,
    PRIMARY KEY (user_id, day)
);
INSERT INTO user_days (user_id, day) SELECT DISTINCT user_id, created_at::date FROM observations ON CONFLICT DO NOTHING;
INSERT INTO user_days (user_id, day) SELECT user_id, day FROM quiz_days ON CONFLICT DO NOTHING;
INSERT INTO user_days (user_id, day) SELECT id, created_at::date FROM users ON CONFLICT DO NOTHING;
-- When a report was dealt with (resolution time).
ALTER TABLE flags ADD COLUMN closed_at timestamptz;
ALTER TABLE user_reports ADD COLUMN closed_at timestamptz;
ALTER TABLE comment_reports ADD COLUMN closed_at timestamptz;
