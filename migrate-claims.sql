-- Phase 2 Part B: listing claim + email verification. Additive only.
-- Apply locally:  wrangler d1 execute townsquare --local --file=migrate-claims.sql
-- Apply remote:   wrangler d1 execute townsquare --remote --file=migrate-claims.sql -y

CREATE TABLE IF NOT EXISTS listing_claims (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id              INTEGER NOT NULL REFERENCES businesses(id),
  claimant_name            TEXT NOT NULL,
  claimant_email           TEXT NOT NULL,
  claimant_phone           TEXT,
  claimant_role            TEXT,               -- 'Owner'|'Manager'|'Employee'|'Other'
  message                  TEXT,
  status                   TEXT NOT NULL DEFAULT 'started',
    -- started | verification_required | pending_review | approved | rejected | revoked | completed
  email_verified_at        TEXT,
  accept_code              TEXT UNIQUE,        -- minted only on admin approval
  accept_code_expires_at   TEXT,
  reviewed_by              TEXT,               -- 'admin' sentinel, matches audit_log actor convention
  reviewed_at              TEXT,
  reject_reason            TEXT,
  accepted_user_id         INTEGER REFERENCES users(id),
  ip                       TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_claims_business ON listing_claims(business_id, status);
CREATE INDEX IF NOT EXISTS idx_claims_status   ON listing_claims(status, created_at);

-- Keyed by claim_id (not email) so business isolation is structural — every query is
-- WHERE claim_id=?, and claim_id is FK'd to exactly one business_id.
CREATE TABLE IF NOT EXISTS claim_otp_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id    INTEGER NOT NULL REFERENCES listing_claims(id),
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,                    -- HMAC-SHA256(code, SESSION_SECRET)
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_claim_otp_claim ON claim_otp_codes(claim_id, created_at);

-- businesses: durable claim signal going forward (the Part A shared-hash heuristic is a
-- legacy artifact that becomes meaningless the moment a reseed changes the placeholder).
ALTER TABLE businesses ADD COLUMN claim_status TEXT NOT NULL DEFAULT 'unclaimed'; -- unclaimed|claim_pending|claimed
ALTER TABLE businesses ADD COLUMN claimed_at TEXT;
CREATE INDEX IF NOT EXISTS idx_biz_claim_status ON businesses(claim_status);
