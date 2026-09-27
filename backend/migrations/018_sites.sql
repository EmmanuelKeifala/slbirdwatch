-- OBS-04 named sites / hotspots. Shared: anyone can pick a nearby site for their sighting.
CREATE TABLE sites (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       text NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
    location   geography(Point, 4326) NOT NULL,
    created_by bigint REFERENCES users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sites_location_idx ON sites USING gist (location);

ALTER TABLE observations ADD COLUMN site_id bigint REFERENCES sites (id) ON DELETE SET NULL;
