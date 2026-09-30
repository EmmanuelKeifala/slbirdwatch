-- LIB-01: species page text for Sierra Leone birds, from the English Wikipedia article (CC BY-SA 4.0,
-- credited with a link) plus IUCN status from Wikidata (CC0).
CREATE TABLE species_details (
    species_id  bigint PRIMARY KEY REFERENCES species (id) ON DELETE CASCADE,
    status      text NOT NULL CHECK (status IN ('ok', 'missing')),
    title       text NOT NULL DEFAULT '',
    source_url  text NOT NULL DEFAULT '',
    sections    jsonb NOT NULL DEFAULT '[]',  -- [{title, text}] in article order
    highlights  jsonb NOT NULL DEFAULT '[]',  -- [{title, text}]: males and females, young birds, through the year, voice
    length_text text NOT NULL DEFAULT '',     -- e.g. "18–20 cm"
    iucn        text NOT NULL DEFAULT '',     -- LC, NT, VU, EN, CR, DD, EW, EX
    fetched_at  timestamptz NOT NULL DEFAULT now()
);
