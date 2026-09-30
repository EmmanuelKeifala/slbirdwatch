-- LIB-08: several reference photos per Sierra Leone species, tagged male / female / juvenile / adult,
-- from research-grade iNaturalist observations with CC photos (copied into our storage, credited).
CREATE TABLE species_gallery (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    species_id  bigint NOT NULL REFERENCES species (id) ON DELETE CASCADE,
    key         text NOT NULL,
    thumb_key   text NOT NULL,
    width       integer NOT NULL,
    height      integer NOT NULL,
    variant     text NOT NULL DEFAULT '' CHECK (variant IN ('male', 'female', 'juvenile', 'adult', '')),
    month       smallint CHECK (month BETWEEN 1 AND 12), -- when it was photographed (seasonal plumage)
    credit      text NOT NULL,
    licence     text NOT NULL,
    licence_url text NOT NULL,
    source_url  text NOT NULL,
    source_id   text NOT NULL UNIQUE -- e.g. inat-photo:123
);
CREATE INDEX species_gallery_species_idx ON species_gallery (species_id);

-- Species already looked up (so reruns resume), with iNaturalist's taxon id when found.
CREATE TABLE species_gallery_runs (
    species_id bigint PRIMARY KEY REFERENCES species (id) ON DELETE CASCADE,
    inat_taxon bigint,
    fetched_at timestamptz NOT NULL DEFAULT now()
);
