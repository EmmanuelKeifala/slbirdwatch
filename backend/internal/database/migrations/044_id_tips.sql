-- LIB-10: expert ID tips. General ("how to know it") when other_species_id is null, otherwise how to tell a pair
-- apart; a pair is stored once (lower id first) and shows on both birds' pages.
CREATE TABLE id_tips (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    species_id       bigint NOT NULL REFERENCES species (id) ON DELETE CASCADE,
    other_species_id bigint REFERENCES species (id) ON DELETE CASCADE CHECK (other_species_id > species_id),
    text             text NOT NULL CHECK (length(text) BETWEEN 10 AND 1000),
    author_id        bigint REFERENCES users (id) ON DELETE SET NULL,
    updated_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE NULLS NOT DISTINCT (species_id, other_species_id)
);
CREATE INDEX id_tips_other_idx ON id_tips (other_species_id);
