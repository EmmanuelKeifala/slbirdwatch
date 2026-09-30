-- OBS-09: the app's own id for a sighting saved offline, so a retried upload never creates it twice.
ALTER TABLE observations ADD COLUMN client_id text CHECK (length(client_id) <= 64);
CREATE UNIQUE INDEX observations_client_id_idx ON observations (user_id, client_id) WHERE client_id IS NOT NULL;
