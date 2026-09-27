-- OBS-03 sounds: media rows of kind 'sound' (key = AAC .m4a, thumb_key = spectrogram PNG).
ALTER TABLE media DROP CONSTRAINT media_kind_check;
ALTER TABLE media ADD CONSTRAINT media_kind_check CHECK (kind IN ('photo', 'sound'));
ALTER TABLE media ADD COLUMN duration_ms integer;
