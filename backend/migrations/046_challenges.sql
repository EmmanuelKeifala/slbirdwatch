-- GAM-01 weekly challenges: three per week (slot 0–2), picked from templates the first time a week is asked for
-- (ADM-05 will let admins write their own). kind + param say how progress is measured.
CREATE TABLE challenges (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    week        date NOT NULL CHECK (extract(isodow FROM week) = 1), -- Monday
    slot        smallint NOT NULL,
    kind        text NOT NULL CHECK (kind IN ('family_photo', 'dawn_song', 'new_site', 'species_week', 'quiz_days', 'help_ids')),
    param       text NOT NULL DEFAULT '', -- family_photo: family_sci
    title       text NOT NULL,
    description text NOT NULL,
    goal        integer NOT NULL CHECK (goal > 0),
    UNIQUE (week, slot)
);
