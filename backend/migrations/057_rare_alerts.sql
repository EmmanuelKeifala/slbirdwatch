-- COM-04 / NTF-03: opt-in alerts when a rare bird is verified within your alert area.
ALTER TABLE users
    ADD COLUMN rare_alerts boolean NOT NULL DEFAULT false,
    ADD COLUMN alert_lat   float8,
    ADD COLUMN alert_lng   float8,
    ADD COLUMN alert_km    integer NOT NULL DEFAULT 25 CHECK (alert_km BETWEEN 5 AND 100);
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('identification', 'status', 'comment', 'reply', 'rare'));
