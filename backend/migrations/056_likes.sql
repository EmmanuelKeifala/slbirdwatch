-- COM-02: like a sighting (one like per person; your own sightings too).
CREATE TABLE observation_likes (
    observation_id bigint NOT NULL REFERENCES observations (id) ON DELETE CASCADE,
    user_id        bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (observation_id, user_id)
);
