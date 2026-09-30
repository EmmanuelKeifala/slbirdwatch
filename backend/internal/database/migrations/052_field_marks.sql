-- LRN-03: verifiers pin labelled field marks ("white eye-ring") on reference photos (VER-07).
-- media_ref is "gallery:<id>" or "photo:<id>"; x and y are fractions of the photo's width and height.
CREATE TABLE field_marks (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    media_ref  text NOT NULL CHECK (media_ref ~ '^(gallery|photo):[0-9]+$'),
    x          real NOT NULL CHECK (x BETWEEN 0 AND 1),
    y          real NOT NULL CHECK (y BETWEEN 0 AND 1),
    label      text NOT NULL CHECK (length(label) BETWEEN 2 AND 40),
    author_id  bigint REFERENCES users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX field_marks_ref_idx ON field_marks (media_ref);
