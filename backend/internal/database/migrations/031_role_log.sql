-- ADM-04: role changes are logged with the other moderation actions.
ALTER TABLE moderation_actions DROP CONSTRAINT moderation_actions_action_check;
ALTER TABLE moderation_actions ADD CONSTRAINT moderation_actions_action_check
    CHECK (action IN ('hide', 'restore', 'remove', 'dismiss', 'warn', 'suspend', 'ban', 'unban', 'role'));
