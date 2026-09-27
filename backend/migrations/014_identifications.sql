-- VER-01/02 community identification. The observer's own species_id counts as their ID;
-- other members add rows here (one current row per member per observation).
CREATE TABLE identifications (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    observation_id bigint NOT NULL REFERENCES observations (id) ON DELETE CASCADE,
    user_id        bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    species_id     bigint NOT NULL REFERENCES species (id),
    reason         text NOT NULL DEFAULT '' CHECK (length(reason) <= 500),
    is_current     boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX identifications_current_idx ON identifications (observation_id, user_id) WHERE is_current;

CREATE TYPE observation_status AS ENUM ('needs_id', 'community', 'verified');
ALTER TABLE observations
    ADD COLUMN status observation_status NOT NULL DEFAULT 'needs_id',
    ADD COLUMN community_species_id bigint REFERENCES species (id);
CREATE INDEX observations_status_idx ON observations (status, created_at DESC);

-- VER-05 flags; reviewed in the moderation queue (ADM-01).
CREATE TYPE flag_reason AS ENUM ('wrong_id', 'captive', 'poor_quality', 'inappropriate', 'sensitive_location');
CREATE TABLE flags (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    observation_id bigint NOT NULL REFERENCES observations (id) ON DELETE CASCADE,
    user_id        bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    reason         flag_reason NOT NULL,
    note           text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
    status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
    created_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (observation_id, user_id, reason)
);
CREATE INDEX flags_open_idx ON flags (status, created_at) WHERE status = 'open';
