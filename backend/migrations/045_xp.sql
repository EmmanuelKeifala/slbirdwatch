-- GAM-02/08: correct quiz answers per day, so quiz XP can be capped per day (quiz totals come from the app).
CREATE TABLE quiz_days (
    user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    day     date NOT NULL,
    correct integer NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
);
-- Earlier quizzes count once, on the day they were last synced (the daily cap still applies).
INSERT INTO quiz_days (user_id, day, correct) SELECT user_id, updated_at::date, correct FROM quiz_stats WHERE correct > 0;
