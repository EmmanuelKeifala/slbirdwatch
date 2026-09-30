-- LIB-12b seed sounds from Xeno-canto (whole recordings ≤60 s, format-converted only: many are CC BY-NC-ND).
CREATE TABLE species_sounds (
    species_id    bigint PRIMARY KEY REFERENCES species (id) ON DELETE CASCADE,
    status        text NOT NULL CHECK (status IN ('ok', 'missing')),
    key           text,           -- AAC .m4a
    spec_key      text,           -- spectrogram PNG
    duration_ms   integer,
    call_type     text NOT NULL DEFAULT '', -- Xeno-canto "type", e.g. "song", "call"
    credit        text NOT NULL DEFAULT '', -- recordist
    licence       text NOT NULL DEFAULT '', -- e.g. "CC BY-NC-SA 4.0"
    licence_url   text NOT NULL DEFAULT '',
    source_url    text NOT NULL DEFAULT '', -- Xeno-canto recording page
    quiz_suitable boolean NOT NULL DEFAULT true,
    fetched_at    timestamptz NOT NULL DEFAULT now(),
    CHECK (status = 'missing' OR (key IS NOT NULL AND spec_key IS NOT NULL))
);
