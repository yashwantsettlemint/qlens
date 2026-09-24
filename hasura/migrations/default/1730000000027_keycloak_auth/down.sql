ALTER TABLE users
  ADD COLUMN password_hash TEXT NOT NULL DEFAULT '',
  ADD COLUMN failed_login_count int NOT NULL DEFAULT 0,
  ADD COLUMN locked_until timestamptz;
ALTER TABLE users ALTER COLUMN password_hash DROP DEFAULT;
