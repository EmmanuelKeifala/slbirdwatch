-- OBS-15: perceptual fingerprint of each photo (difference hash), to spot the same picture uploaded again.
ALTER TABLE media ADD COLUMN phash bigint;
CREATE INDEX media_phash_idx ON media (phash) WHERE phash IS NOT NULL;
