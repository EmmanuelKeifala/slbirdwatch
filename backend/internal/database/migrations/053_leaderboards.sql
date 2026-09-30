-- GAM-05: people can keep themselves off leaderboards (private profiles are never listed either).
ALTER TABLE users ADD COLUMN hide_from_leaderboards boolean NOT NULL DEFAULT false;
