-- LIB-09: community recordings are tagged too (song / call / alarm / flight call), in the same column as photo tags.
ALTER TABLE media DROP CONSTRAINT media_tags_check;
ALTER TABLE media ADD CONSTRAINT media_tags_check CHECK (tags <@ ARRAY['male', 'female', 'juvenile', 'adult', 'breeding',
    'non-breeding', 'in-flight', 'song', 'call', 'alarm', 'flight']);
