-- migrate-audit-log.sql — ADDITIVE ONLY. Creates the internal audit trail.
--
-- Apply locally:  wrangler d1 execute townsquare --local  --file=migrate-audit-log.sql
-- Apply remote:   wrangler d1 execute townsquare --remote --file=migrate-audit-log.sql -y
--
-- This file DROPs nothing, ALTERs nothing, and touches no existing table. It is
-- safe to re-run (every statement is IF NOT EXISTS).
--
-- WHY THIS EXISTS
-- `activity_log` is a per-business, owner-READABLE feed wired only into the
-- owner-dashboard routes. It cannot answer "who changed this?" for the two paths
-- that actually caused trouble: the square-admin event DELETE (shared PIN, no
-- logging) and the public self-serve join (no auth, no logging). audit_log is a
-- separate, INTERNAL-ONLY table covering every write path in _worker.js.
--
-- PRIVACY CONTRACT (enforced in _worker.js, restated here so the schema explains
-- itself): no PIN, PIN hash, salt, OTP, session token, invite code, phone number,
-- email address, or raw IP is ever written to this table. `ip_hash` is a KEYED
-- HMAC (not a plain digest) — the IPv4 space is only ~4 billion addresses, so a
-- bare sha256 of an IP is reversible by brute force in seconds. The HMAC key is a
-- Worker secret, so the hash is correlatable ("same visitor") without being
-- reversible ("which visitor").

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  -- UTC ISO-8601 with milliseconds, written by the app (not SQLite's datetime('now'),
  -- which is second-resolution local-format and would make ordering ties ambiguous
  -- when several rows land inside one request).
  ts          TEXT NOT NULL,
  -- WHO: a business slug, or one of the sentinels 'admin' (square PIN holder),
  -- 'public' (unauthenticated visitor), 'system' (worker-initiated).
  actor       TEXT NOT NULL,
  -- WHAT: dotted verb, e.g. 'event.delete', 'business.create', 'team.role_change'.
  action      TEXT NOT NULL,
  -- WHICH: the table/kind touched, and its row id (TEXT so non-integer keys fit).
  entity_type TEXT,
  entity_id   TEXT,
  -- Short human-readable string for a person scanning the log. Never carries a
  -- secret or a raw identifier — see the privacy contract above.
  summary     TEXT,
  -- Keyed HMAC of the client IP, truncated to 16 hex chars. NOT a raw IP.
  ip_hash     TEXT,
  -- Cloudflare's CF-Ray for this request, when present — ties an audit row back to
  -- the Cloudflare request log for the same event.
  request_id  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- "What happened recently?" — the default read, newest first.
CREATE INDEX IF NOT EXISTS idx_audit_ts     ON audit_log(ts DESC);
-- "Everything this actor did" — the who-changed-my-data question.
CREATE INDEX IF NOT EXISTS idx_audit_actor  ON audit_log(actor, ts DESC);
-- "The full history of this one record" — e.g. which event row got deleted, when.
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id, ts DESC);
