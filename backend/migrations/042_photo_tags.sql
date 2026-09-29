-- LIB-08: what a photo shows. Observers tag their own photos; verifiers tag any photo, gallery ones too.
ALTER TABLE media ADD COLUMN tags text[] NOT NULL DEFAULT '{}'
    CHECK (tags <@ ARRAY['male', 'female', 'juvenile', 'adult', 'breeding', 'non-breeding', 'in-flight']);
ALTER TABLE species_gallery ADD COLUMN tags text[] NOT NULL DEFAULT '{}'
    CHECK (tags <@ ARRAY['male', 'female', 'juvenile', 'adult', 'breeding', 'non-breeding', 'in-flight']);
UPDATE species_gallery SET tags = ARRAY[variant] WHERE variant <> '';
