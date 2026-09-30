-- OBS-12 licence per uploaded media item, defaulting to the uploader's profile choice.
CREATE TYPE media_licence AS ENUM ('cc0', 'cc-by', 'cc-by-nc', 'all-rights-reserved');
ALTER TABLE users ADD COLUMN default_licence media_licence NOT NULL DEFAULT 'cc-by-nc';
ALTER TABLE media ADD COLUMN licence media_licence NOT NULL DEFAULT 'cc-by-nc';
