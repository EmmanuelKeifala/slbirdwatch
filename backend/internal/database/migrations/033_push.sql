-- NTF-01 push: Expo push tokens per device, and which notifications were already pushed.
CREATE TABLE push_tokens (
    token      text PRIMARY KEY CHECK (length(token) <= 200),
    user_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    platform   text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_tokens_user_idx ON push_tokens (user_id);
ALTER TABLE notifications ADD COLUMN pushed_at timestamptz;
