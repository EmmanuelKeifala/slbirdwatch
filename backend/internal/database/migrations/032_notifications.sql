-- NTF-01/04 in-app notifications, with per-category settings. Push delivery can read the same rows later.
ALTER TABLE users
    ADD COLUMN notify_ids    boolean NOT NULL DEFAULT true, -- someone suggested or agreed with an ID on my sighting
    ADD COLUMN notify_status boolean NOT NULL DEFAULT true; -- my sighting reached Community ID or Verified

CREATE TABLE notifications (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id        bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind           text NOT NULL CHECK (kind IN ('identification', 'status')),
    observation_id bigint NOT NULL REFERENCES observations (id) ON DELETE CASCADE,
    actor_id       bigint REFERENCES users (id) ON DELETE CASCADE, -- who identified (identification only)
    species_id     bigint REFERENCES species (id),
    status         text NOT NULL DEFAULT '', -- community | verified (status only)
    read_at        timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
