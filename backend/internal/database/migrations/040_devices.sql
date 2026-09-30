-- Devices getting push notifications: a readable name for each phone, and when it was first added.
ALTER TABLE push_tokens ADD COLUMN device_name text NOT NULL DEFAULT '' CHECK (length(device_name) <= 80),
                        ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
