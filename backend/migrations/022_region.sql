-- OBS-06: species recorded in the launch region (Sierra Leone), from GBIF, with records per month (Jan..Dec).
-- ponytail: one region; add a region column when there is a second.
CREATE TABLE region_species (
    species_id bigint PRIMARY KEY REFERENCES species (id) ON DELETE CASCADE,
    records    integer NOT NULL,
    months     integer[] NOT NULL CHECK (cardinality(months) = 12)
);

-- Local / other-language names (filled via ADM-02); the species picker searches them too.
CREATE TABLE species_local_names (
    species_id bigint NOT NULL REFERENCES species (id) ON DELETE CASCADE,
    name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    language   text NOT NULL DEFAULT '', -- e.g. 'kri' (Krio), 'men' (Mende), 'tem' (Temne)
    PRIMARY KEY (species_id, name)
);
CREATE INDEX species_local_names_trgm_idx ON species_local_names USING gin (name gin_trgm_ops);
