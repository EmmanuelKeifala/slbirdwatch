-- ADM-02 taxonomy updates. A merged (lumped) species is retired: hidden from lists and pickers, its sightings,
-- IDs and media moved to the species it joined. A split species stays (nothing is lost) and points at the
-- new species; its sightings go back to verifiers for re-identification.
ALTER TABLE species
    ADD COLUMN merged_into bigint REFERENCES species (id),
    ADD COLUMN split_into  bigint[] NOT NULL DEFAULT '{}';

CREATE TABLE taxonomy_changes (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind         text NOT NULL CHECK (kind IN ('merge', 'split')),
    from_species bigint NOT NULL REFERENCES species (id) ON DELETE CASCADE,
    into_species bigint[] NOT NULL,
    admin_id     bigint REFERENCES users (id) ON DELETE SET NULL,
    note         text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
    created_at   timestamptz NOT NULL DEFAULT now()
);
