-- VER-07: verifiers mark the best photos of a species as reference quality (species page, library, lessons).
ALTER TABLE media ADD COLUMN reference boolean NOT NULL DEFAULT false;
ALTER TABLE species_gallery ADD COLUMN reference boolean NOT NULL DEFAULT false;
