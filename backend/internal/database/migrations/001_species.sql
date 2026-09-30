CREATE TABLE species (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    seq               integer NOT NULL,          -- taxonomic sort order within the taxonomy version
    scientific_name   text NOT NULL UNIQUE,
    english_name      text NOT NULL,
    order_name        text NOT NULL,
    family_sci        text NOT NULL,
    family_en         text NOT NULL,
    genus             text NOT NULL,
    authority         text NOT NULL DEFAULT '',
    breeding_range    text NOT NULL DEFAULT '',
    nonbreeding_range text NOT NULL DEFAULT '',
    extinct           boolean NOT NULL DEFAULT false,
    sensitive         boolean NOT NULL DEFAULT false, -- OBS-14: obscure locations for these
    taxonomy_version  text NOT NULL,
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX species_family_idx ON species (family_sci);
CREATE INDEX species_seq_idx ON species (seq);
