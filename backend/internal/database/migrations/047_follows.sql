-- COM-01 (and the start of COM-02): follow people to see their verified sightings in your activity feed.
CREATE TABLE follows (
    follower_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    followee_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, followee_id),
    CHECK (follower_id <> followee_id)
);
CREATE INDEX follows_followee_idx ON follows (followee_id);
