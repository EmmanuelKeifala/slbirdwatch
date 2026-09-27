-- OBS-08 submitter's confidence in their own ID (NULL when the species is unknown or not given).
CREATE TYPE id_confidence AS ENUM ('certain', 'likely', 'guess');
ALTER TABLE observations ADD COLUMN confidence id_confidence;
