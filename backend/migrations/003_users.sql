CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         citext NOT NULL UNIQUE,
    password_hash text,  -- NULL for accounts that only use Google/Apple sign-in
    display_name  text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 50),
    created_at    timestamptz NOT NULL DEFAULT now()
);
