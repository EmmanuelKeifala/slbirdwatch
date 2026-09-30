-- LIB-12 seed photos from Wikimedia Commons (free licences only), shown until community photos exist.
-- status 'missing' = looked up, no free image found (skipped on later seed runs).
CREATE TABLE species_images (
    species_id  bigint PRIMARY KEY REFERENCES species (id) ON DELETE CASCADE,
    status      text NOT NULL CHECK (status IN ('ok', 'missing')),
    key         text,
    thumb_key   text,
    width       integer,
    height      integer,
    credit      text NOT NULL DEFAULT '', -- photographer, plain text
    licence     text NOT NULL DEFAULT '', -- e.g. "CC BY-SA 2.0"
    licence_url text NOT NULL DEFAULT '',
    source_url  text NOT NULL DEFAULT '', -- Commons file page
    fetched_at  timestamptz NOT NULL DEFAULT now(),
    CHECK (status = 'missing' OR (key IS NOT NULL AND thumb_key IS NOT NULL))
);
