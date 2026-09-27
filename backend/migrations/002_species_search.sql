CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX species_english_trgm_idx ON species USING gin (english_name gin_trgm_ops);
CREATE INDEX species_scientific_trgm_idx ON species USING gin (scientific_name gin_trgm_ops);
