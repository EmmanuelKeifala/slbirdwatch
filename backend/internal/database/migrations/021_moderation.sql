-- ADM-01 moderation.
ALTER TABLE observations ADD COLUMN hidden boolean NOT NULL DEFAULT false; -- removed from every public view
ALTER TABLE users
    ADD COLUMN banned          boolean NOT NULL DEFAULT false,
    ADD COLUMN suspended_until timestamptz;

CREATE TABLE moderation_actions (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    moderator_id bigint REFERENCES users (id) ON DELETE SET NULL,
    target_type  text NOT NULL CHECK (target_type IN ('observation', 'user')),
    target_id    bigint NOT NULL,
    action       text NOT NULL CHECK (action IN ('hide', 'restore', 'remove', 'dismiss', 'warn', 'suspend', 'ban', 'unban')),
    note         text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_actions_target_idx ON moderation_actions (target_type, target_id, created_at DESC);
