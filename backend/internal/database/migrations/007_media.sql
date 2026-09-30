-- OBS-02 photos (audio joins in OBS-03). Rows cascade with the observation; S3 objects are removed by the API.
CREATE TABLE media (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    observation_id bigint NOT NULL REFERENCES observations (id) ON DELETE CASCADE,
    kind           text NOT NULL CHECK (kind IN ('photo')),
    key            text NOT NULL,
    thumb_key      text,
    width          integer,
    height         integer,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX media_observation_idx ON media (observation_id, id);
