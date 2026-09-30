-- NTF-02: pushes for new weekly challenges and streak reminders, switchable in the profile. reminders_sent makes
-- each one go out once (per user, kind and day/week), across restarts and several API instances.
ALTER TABLE users ADD COLUMN notify_reminders boolean NOT NULL DEFAULT true;
CREATE TABLE reminders_sent (
    user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind    text NOT NULL CHECK (kind IN ('challenges', 'quiz_streak', 'outing_streak')),
    key     date NOT NULL, -- the week or day it's for
    sent_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, kind, key)
);
