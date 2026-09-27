-- COM-06: community guidelines & birding ethics must be accepted before a first upload.
ALTER TABLE users ADD COLUMN guidelines_accepted_at timestamptz;
