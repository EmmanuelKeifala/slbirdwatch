-- LRN-08: a memory phrase for a bird's song or call ("I am a red-eyed dove"), one per species, written by
-- verifiers. A few well-known ones to start, for Sierra Leone birds.
CREATE TABLE species_mnemonics (
    species_id bigint PRIMARY KEY REFERENCES species (id) ON DELETE CASCADE,
    text       text NOT NULL CHECK (length(text) BETWEEN 3 AND 140),
    author_id  bigint REFERENCES users (id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO species_mnemonics (species_id, text)
SELECT s.id, m.text FROM (VALUES
    ('Streptopelia semitorquata', '“I am a red-eyed dove”: six coos, the middle ones stressed.'),
    ('Pycnonotus barbatus', '“Quick, doctor, quick!” A cheerful, bubbling phrase from a bush top.'),
    ('Cuculus solitarius', '“It will rain”: three loud notes falling, heard in the rains.'),
    ('Chrysococcyx caprius', 'Says its name: “dee-dee-dee-deederik”, rising and insistent.'),
    ('Turtur afer', 'Soft coos that speed up and fall, like a ball bouncing to a stop.'),
    ('Pogoniulus bilineatus', '“Tonk-tonk-tonk”: a tinker tapping a pot, on and on.'),
    ('Camaroptera brachyura', 'Bleats like a young goat, and snaps like fingers in the undergrowth.'),
    ('Centropus senegalensis', 'Bubbling “hoo-hoo-hoo”, like water poured out of a bottle.')
) AS m (sci, text) JOIN species s ON s.scientific_name = m.sci;
