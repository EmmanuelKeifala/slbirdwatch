-- ACC-02b: Google sign-in. The Google account id ("sub") links a person to their Google account.
ALTER TABLE users ADD COLUMN google_sub text UNIQUE;
