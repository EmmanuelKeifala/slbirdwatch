-- Range map (LIB-01): GBIF's species key, for GBIF's occurrence map tiles.
ALTER TABLE region_species ADD COLUMN gbif_key bigint;
