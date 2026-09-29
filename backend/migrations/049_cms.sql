-- ADM-05: lessons (LRN-02) and weekly challenges (GAM-01) are now written by admins. Lessons move from code
-- to this table, starting with the ten built-in ones. A lesson is either whole families (most recorded birds
-- first, up to 8) or a hand-picked list of birds in order; with neither, Sierra Leone's most recorded birds.
CREATE TABLE lessons (
    slug        text PRIMARY KEY CHECK (slug ~ '^[a-z0-9-]{2,40}$'),
    title       text NOT NULL CHECK (length(title) BETWEEN 2 AND 80),
    blurb       text NOT NULL DEFAULT '' CHECK (length(blurb) <= 300),
    families    text[] NOT NULL DEFAULT '{}',
    species_ids bigint[] NOT NULL DEFAULT '{}' CHECK (cardinality(species_ids) <= 12),
    position    integer NOT NULL DEFAULT 0,
    published   boolean NOT NULL DEFAULT true,
    updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO lessons (slug, title, blurb, families, position) VALUES
    ('common', 'Common birds of Sierra Leone', 'The birds you’ll meet on almost every walk. Start here.', '{}', 0),
    ('sunbirds', 'Sunbirds', 'Tiny, glittering nectar-feeders. Males shine, females are plainer.', '{Nectariniidae}', 1),
    ('kingfishers', 'Kingfishers', 'From river bullets to dry-woodland hunters.', '{Alcedinidae}', 2),
    ('raptors', 'Birds of prey', 'Kites, hawks, eagles and falcons: shape and flight first.', '{Accipitridae,Falconidae}', 3),
    ('herons', 'Herons & egrets', 'Tall wetland hunters: bill, legs and plumes tell them apart.', '{Ardeidae}', 4),
    ('weavers', 'Weavers & bishops', 'Busy colonies, woven nests and breeding-season colours.', '{Ploceidae}', 5),
    ('bee-eaters', 'Bee-eaters & rollers', 'Bright aerial hunters of open country.', '{Meropidae,Coraciidae}', 6),
    ('waders', 'Waders of the coast', 'Sandpipers and plovers: size, bill and legs.', '{Scolopacidae,Charadriidae}', 7),
    ('hornbills', 'Hornbills & turacos', 'Big forest birds with big voices.', '{Bucerotidae,Musophagidae}', 8),
    ('doves', 'Doves & pigeons', 'Similar shapes: collars, eye colour and calls.', '{Columbidae}', 9);
