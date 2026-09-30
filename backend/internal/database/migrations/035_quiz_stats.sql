-- ACC-04: quiz progress kept with the account (guests keep theirs on the phone until they sign in).
CREATE TABLE quiz_stats (
    user_id     bigint PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    quizzes     integer NOT NULL DEFAULT 0,
    answered    integer NOT NULL DEFAULT 0,
    correct     integer NOT NULL DEFAULT 0,
    best_streak integer NOT NULL DEFAULT 0,
    missed      jsonb NOT NULL DEFAULT '{}', -- species id → net times got wrong
    updated_at  timestamptz NOT NULL DEFAULT now()
);
