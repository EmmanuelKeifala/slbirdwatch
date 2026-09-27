-- LIB-09: several Xeno-canto recordings per Sierra Leone species, by kind (song / call / alarm / flight call),
-- preferring Sierra Leone and West Africa, with where and when recorded. Stored whole (many are CC BY-NC-ND).
CREATE TABLE species_sound_gallery (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    species_id    bigint NOT NULL REFERENCES species (id) ON DELETE CASCADE,
    key           text NOT NULL,  -- AAC .m4a
    spec_key      text NOT NULL,  -- spectrogram PNG
    duration_ms   integer NOT NULL,
    kind          text NOT NULL CHECK (kind IN ('song', 'call', 'alarm', 'flight')),
    call_type     text NOT NULL DEFAULT '', -- Xeno-canto's own words, e.g. "call, flight call"
    sex           text NOT NULL DEFAULT '',
    country       text NOT NULL DEFAULT '',
    month         smallint CHECK (month BETWEEN 1 AND 12),
    credit        text NOT NULL,
    licence       text NOT NULL,
    licence_url   text NOT NULL,
    source_url    text NOT NULL,
    source_id     text NOT NULL UNIQUE, -- xc:<id>
    quiz_suitable boolean NOT NULL DEFAULT true
);
CREATE INDEX species_sound_gallery_species_idx ON species_sound_gallery (species_id);

CREATE TABLE species_sound_gallery_runs (
    species_id bigint PRIMARY KEY REFERENCES species (id) ON DELETE CASCADE,
    fetched_at timestamptz NOT NULL DEFAULT now()
);
