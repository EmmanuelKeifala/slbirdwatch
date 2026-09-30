-- QZ-11 head-to-head: a fixed quiz set anyone with the code can play once; scores side by side.
CREATE TABLE duels (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code       text NOT NULL UNIQUE CHECK (code ~ '^[A-Z2-9]{6}$'),
    creator_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind       text NOT NULL CHECK (kind IN ('picture', 'sound')),
    questions  jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT now() + interval '14 days'
);
CREATE TABLE duel_scores (
    duel_id     bigint NOT NULL REFERENCES duels (id) ON DELETE CASCADE,
    user_id     bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    right_count integer NOT NULL CHECK (right_count >= 0),
    answered    integer NOT NULL CHECK (answered >= right_count),
    time_ms     integer NOT NULL CHECK (time_ms >= 0),
    finished_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (duel_id, user_id)
);
CREATE INDEX duel_scores_user_idx ON duel_scores (user_id, finished_at DESC);
