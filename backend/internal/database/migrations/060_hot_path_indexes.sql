-- Indexes for the busiest reads.
-- Community-agreed species: species photos, reference photo, quiz features, library filters, "near me".
CREATE INDEX observations_community_species_idx ON observations (community_species_id, status) WHERE NOT hidden;
-- The public feed without a status filter: newest first, stop after a page.
CREATE INDEX observations_feed_idx ON observations (created_at DESC, id DESC) WHERE NOT hidden;
-- The quiz's "seen by the community in the last 30 days" tier.
CREATE INDEX observations_observed_idx ON observations (observed_at) WHERE NOT hidden;
