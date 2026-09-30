-- VER-08: a sighting whose species is unlikely for the place (never recorded in Sierra Leone) or the date
-- (well recorded, but not within a month of this one). Community agreement alone can't settle it: it waits
-- for a verifier.
ALTER TABLE observations ADD COLUMN unusual text NOT NULL DEFAULT '' CHECK (unusual IN ('', 'range', 'season'));
CREATE INDEX observations_unusual_idx ON observations (created_at DESC) WHERE unusual <> '';
