-- Multi-user team layer (Phase 1 owner dashboard). businesses.pin_hash/salt is
-- UNCHANGED and becomes the OWNER's credential — see _worker.js /api/auth/login,
-- which lazily creates a `users` OWNER row reusing that same hash on first login
-- after this migration. Safe to re-run (IF NOT EXISTS).
-- Apply locally:  wrangler d1 execute townsquare --local --file=migrate-add-users-roles.sql
-- Apply remote:   wrangler d1 execute townsquare --remote --file=migrate-add-users-roles.sql -y

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id   INTEGER NOT NULL REFERENCES businesses(id),
  name          TEXT NOT NULL,
  pin_hash      TEXT NOT NULL,
  salt          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'STAFF',   -- 'OWNER' | 'MANAGER' | 'STAFF'
  is_active     INTEGER NOT NULL DEFAULT 1,      -- revoke = 0; row kept for activity_log integrity
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_business ON users(business_id);

CREATE TABLE IF NOT EXISTS business_invitations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id      INTEGER NOT NULL REFERENCES businesses(id),
  invite_code      TEXT NOT NULL UNIQUE,
  name             TEXT,
  role             TEXT NOT NULL DEFAULT 'STAFF',
  invited_by       INTEGER REFERENCES users(id),
  status           TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'accepted' | 'revoked' | 'expired'
  expires_at       TEXT NOT NULL,
  accepted_user_id INTEGER REFERENCES users(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invites_business ON business_invitations(business_id, status);
