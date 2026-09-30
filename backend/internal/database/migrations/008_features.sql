-- OBS-05 structured ID features, validated by the API against its vocabulary (features.go).
ALTER TABLE observations ADD COLUMN features jsonb NOT NULL DEFAULT '{}';
CREATE INDEX observations_features_idx ON observations USING gin (features jsonb_path_ops);
