-- LRN-06: quiz results per bird ([right, wrong]) and per kind (picture / sound) for the progress dashboard.
ALTER TABLE quiz_stats ADD COLUMN by_species jsonb NOT NULL DEFAULT '{}',
                       ADD COLUMN by_kind    jsonb NOT NULL DEFAULT '{}';
