-- ACC-06. Ordered lowest to highest; a role includes the permissions of those below it.
-- Guests are unauthenticated and have no row.
CREATE TYPE user_role AS ENUM ('member', 'trusted', 'verifier', 'moderator', 'admin');

ALTER TABLE users ADD COLUMN role user_role NOT NULL DEFAULT 'member';
