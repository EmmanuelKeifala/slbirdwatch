-- COM-05: block and report users.
CREATE TABLE blocks (
    blocker_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    blocked_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
);
CREATE INDEX blocks_blocked_idx ON blocks (blocked_id);

CREATE TYPE user_report_reason AS ENUM ('spam', 'harassment', 'impersonation', 'other');
CREATE TABLE user_reports (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    reporter_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    reported_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    reason      user_report_reason NOT NULL,
    note        text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
    status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (reporter_id, reported_id, reason)
);
