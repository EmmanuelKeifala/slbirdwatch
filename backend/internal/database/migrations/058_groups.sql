-- COM-03 groups / clubs (and GAM-07 group challenges): members join with a code; only members see a group.
CREATE TABLE groups (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        text NOT NULL CHECK (length(name) BETWEEN 2 AND 60),
    description text NOT NULL DEFAULT '' CHECK (length(description) <= 300),
    kind        text NOT NULL DEFAULT 'club' CHECK (kind IN ('club', 'school', 'friends')),
    join_code   text NOT NULL UNIQUE CHECK (join_code ~ '^[A-Z2-9]{6}$'),
    owner_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE group_members (
    group_id  bigint NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    user_id   bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_members_user_idx ON group_members (user_id);
-- GAM-07: a shared target for the group, e.g. 50 species between them this month.
CREATE TABLE group_challenges (
    id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    group_id  bigint NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    title     text NOT NULL CHECK (length(title) BETWEEN 2 AND 60),
    goal      integer NOT NULL CHECK (goal BETWEEN 1 AND 1000), -- species between them
    starts_at timestamptz NOT NULL,
    ends_at   timestamptz NOT NULL CHECK (ends_at > starts_at)
);
