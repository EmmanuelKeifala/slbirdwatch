-- ACC-05
CREATE TYPE experience_level AS ENUM ('beginner', 'intermediate', 'advanced', 'expert');

ALTER TABLE users
    ADD COLUMN avatar_key       text,
    ADD COLUMN home_area        text NOT NULL DEFAULT '' CHECK (length(home_area) <= 80),
    ADD COLUMN experience_level experience_level,
    ADD COLUMN bio              text NOT NULL DEFAULT '' CHECK (length(bio) <= 500);
