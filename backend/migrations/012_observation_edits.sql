-- OBS-11 edit history: one row per edit with {field: {"from": old, "to": new}} for changed fields.
CREATE TABLE observation_edits (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    observation_id bigint NOT NULL REFERENCES observations (id) ON DELETE CASCADE,
    edited_at      timestamptz NOT NULL DEFAULT now(),
    changes        jsonb NOT NULL
);
CREATE INDEX observation_edits_observation_idx ON observation_edits (observation_id, edited_at);
