-- VER-09 comments on sightings: one level of replies, soft-deleted by their author, reportable, hideable by moderators.
CREATE TABLE comments (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    observation_id bigint NOT NULL REFERENCES observations (id) ON DELETE CASCADE,
    user_id        bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    parent_id      bigint REFERENCES comments (id) ON DELETE CASCADE, -- a reply to this top-level comment
    body           text NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
    deleted        boolean NOT NULL DEFAULT false,
    hidden         boolean NOT NULL DEFAULT false, -- by a moderator
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_observation_idx ON comments (observation_id, created_at);

CREATE TABLE comment_reports (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    comment_id bigint NOT NULL REFERENCES comments (id) ON DELETE CASCADE,
    user_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    reason     text NOT NULL CHECK (reason IN ('spam', 'harassment', 'inappropriate', 'other')),
    status     text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (comment_id, user_id)
);

ALTER TABLE users ADD COLUMN notify_comments boolean NOT NULL DEFAULT true;
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('identification', 'status', 'comment', 'reply'));
ALTER TABLE moderation_actions DROP CONSTRAINT moderation_actions_target_type_check;
ALTER TABLE moderation_actions ADD CONSTRAINT moderation_actions_target_type_check CHECK (target_type IN ('observation', 'user', 'comment'));
