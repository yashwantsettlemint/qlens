-- Login lockout: track consecutive failed attempts, lock for a cooldown once
-- MAX_FAILED_ATTEMPTS is hit (see services/auth-service/app/users.py).
ALTER TABLE users
  ADD COLUMN failed_login_count int NOT NULL DEFAULT 0,
  ADD COLUMN locked_until timestamptz;
