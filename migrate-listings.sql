-- Titusville Square — listing intake queues (Part 2 + Part 3)
-- Target: hub D1 'townsquare'. Apply once, AFTER Chrissy's go-ahead:
--   wrangler d1 execute townsquare --remote --file=migrate-listings.sql -y
-- All CREATE ... IF NOT EXISTS — safe to run; adds new empty tables only.

-- Part 2: free-listing submissions (a business asking to be listed)
CREATE TABLE IF NOT EXISTS listing_submissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  town        TEXT NOT NULL DEFAULT 'titusville',
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  address     TEXT,
  phone       TEXT,
  email       TEXT NOT NULL,
  website     TEXT,
  hours       TEXT,
  description TEXT NOT NULL,
  want_audit  INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  ip          TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lsub_status ON listing_submissions (status, created_at);

-- Part 3: correction / removal requests (for an already-listed business)
CREATE TABLE IF NOT EXISTS listing_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  town          TEXT NOT NULL DEFAULT 'titusville',
  business_name TEXT NOT NULL,
  requester     TEXT NOT NULL,
  email         TEXT NOT NULL,
  relationship  TEXT,                            -- Owner | Manager | Employee | Other
  kind          TEXT NOT NULL,                   -- correct | remove
  details       TEXT,
  status        TEXT NOT NULL DEFAULT 'open',     -- open | resolved
  ip            TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lreq_status ON listing_requests (status, created_at);

-- Shared rate-limit ledger (3 submissions per IP per hour). No KV needed.
CREATE TABLE IF NOT EXISTS form_hits (
  ip         TEXT NOT NULL,
  form       TEXT NOT NULL,                       -- 'submission' | 'request'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_formhits ON form_hits (ip, form, created_at);
