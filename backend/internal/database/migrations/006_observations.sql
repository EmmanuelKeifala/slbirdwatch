-- OBS-01. Deleting a user deletes their observations (ACC-07); revisit if verified records should be kept anonymised.
CREATE TABLE observations (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    species_id  bigint REFERENCES species (id), -- NULL = "I don't know"
    observed_at timestamptz NOT NULL,
    location    geography(Point, 4326) NOT NULL,
    accuracy_m  real CHECK (accuracy_m >= 0),
    count       integer NOT NULL DEFAULT 1 CHECK (count BETWEEN 1 AND 100000),
    notes       text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX observations_user_idx ON observations (user_id, observed_at DESC);
CREATE INDEX observations_species_idx ON observations (species_id);
CREATE INDEX observations_location_idx ON observations USING gist (location);
