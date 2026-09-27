-- ACC-08 privacy settings.
ALTER TABLE users
    ADD COLUMN hide_locations  boolean NOT NULL DEFAULT false, -- obscure my sightings' coordinates for others
    ADD COLUMN private_profile boolean NOT NULL DEFAULT false; -- others see only my name and avatar
