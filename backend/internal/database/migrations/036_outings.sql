-- OBS-10 outings: a birding walk with its route; sightings logged during it point at it.
CREATE TABLE outings (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    client_id  text NOT NULL CHECK (length(client_id) <= 64), -- the phone's id, so offline retries never duplicate
    started_at timestamptz NOT NULL,
    ended_at   timestamptz,
    route      geography(LineString, 4326),
    UNIQUE (user_id, client_id)
);
ALTER TABLE observations ADD COLUMN outing_id bigint REFERENCES outings (id) ON DELETE SET NULL;
CREATE INDEX observations_outing_idx ON observations (outing_id) WHERE outing_id IS NOT NULL;
