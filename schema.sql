-- TownSquare registry — source of truth for identity, module enrollment, and the
-- public yellow-pages projection. One row per business, per town.
-- Apply locally:  wrangler d1 execute townsquare --local --file=schema.sql
-- Apply remote:   wrangler d1 execute townsquare --remote --file=schema.sql -y

CREATE TABLE IF NOT EXISTS businesses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  town          TEXT NOT NULL DEFAULT 'titusville',
  -- TownSquare account auth: per-account RANDOM salt (not the products' static salt)
  pin_hash      TEXT NOT NULL,
  salt          TEXT NOT NULL,
  -- enrollment: {"herald":true,"drawbridge":true,"belltower":false,"hearth":true,"forge":false}
  modules       TEXT NOT NULL DEFAULT '{}',
  -- optional per-product slug overrides (default: a product is keyed by this same slug)
  product_slugs TEXT,
  -- public yellow-pages profile
  category      TEXT,
  blurb         TEXT,
  address       TEXT,
  phone         TEXT,
  website       TEXT,
  logo          TEXT,
  primary_color TEXT,
  forge_url     TEXT,                       -- deep-link target for the Forge launch tile
  is_public     INTEGER NOT NULL DEFAULT 0, -- gate for appearing in the town directory
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  -- added by migrate-join.sql:
  email           TEXT,
  subscription_id TEXT,
  created_via     TEXT,
  -- added by migrate-add-profile-fields.sql (owner-dashboard yellow-pages fields):
  full_description TEXT,
  secondary_categories TEXT,        -- JSON array of strings
  service_area TEXT,
  public_contact_preference TEXT,   -- 'phone'|'email'|'website'|'visit'
  social_links TEXT,                -- JSON {facebook,instagram,other}
  price_range TEXT,                 -- '$'|'$$'|'$$$'|'$$$$'
  accessibility_info TEXT,
  parking_info TEXT,
  family_friendly INTEGER,          -- nullable tri-state
  pet_friendly INTEGER,             -- nullable tri-state
  appointment_required INTEGER,     -- nullable tri-state
  service_notes TEXT,
  -- added by migrate-claims.sql: durable claim signal (see listing_claims below)
  claim_status TEXT NOT NULL DEFAULT 'unclaimed', -- unclaimed|claim_pending|claimed
  claimed_at TEXT
);

-- Multi-user team layer (migrate-add-users-roles.sql). businesses.pin_hash/salt
-- is unchanged and is the OWNER's credential; a `users` OWNER row is lazily
-- created reusing that same hash on first login post-migration.
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id   INTEGER NOT NULL REFERENCES businesses(id),
  name          TEXT NOT NULL,
  pin_hash      TEXT NOT NULL,
  salt          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'STAFF',   -- 'OWNER' | 'MANAGER' | 'STAFF'
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS business_invitations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id      INTEGER NOT NULL REFERENCES businesses(id),
  invite_code      TEXT NOT NULL UNIQUE,
  name             TEXT,
  role             TEXT NOT NULL DEFAULT 'STAFF',
  invited_by       INTEGER REFERENCES users(id),
  status           TEXT NOT NULL DEFAULT 'pending',
  expires_at       TEXT NOT NULL,
  accepted_user_id INTEGER REFERENCES users(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Town-wide events (v1 community write-side; owner-posted)
CREATE TABLE IF NOT EXISTS town_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id  INTEGER REFERENCES businesses(id),
  town         TEXT NOT NULL DEFAULT 'titusville',
  title        TEXT NOT NULL,
  starts_at    TEXT NOT NULL,               -- local wall-clock 'YYYY-MM-DD HH:MM'
  ends_at      TEXT,
  location     TEXT,
  description  TEXT,
  is_published INTEGER NOT NULL DEFAULT 0,
  is_kids      INTEGER NOT NULL DEFAULT 0,   -- 1 = kid/family-friendly (Kids calendar)
  source       TEXT NOT NULL DEFAULT 'curated', -- 'curated' (seed file) | 'submitted' (public form) | 'owner' (owner dashboard)
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  -- added by migrate-events-owner-fields.sql (owner-facing event management):
  audience TEXT,
  age_range TEXT,
  category TEXT,
  cost TEXT,
  registration_required INTEGER NOT NULL DEFAULT 0,
  registration_link TEXT,
  contact_info TEXT,
  image TEXT,                       -- URL only, Phase 1 (no upload)
  accessibility_notes TEXT,
  is_canceled INTEGER NOT NULL DEFAULT 0,       -- distinct from is_published: a canceled
                                                 -- published event stays visible, badged
  moderation_required INTEGER NOT NULL DEFAULT 0
);

-- Phase 2 Part B (migrate-claims.sql): stranger-initiated, admin-approved listing
-- claims — replaces the shared-placeholder-PIN pattern with real, individually
-- verified ownership. See project-architecture.md for the full lifecycle.
CREATE TABLE IF NOT EXISTS listing_claims (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id              INTEGER NOT NULL REFERENCES businesses(id),
  claimant_name            TEXT NOT NULL,
  claimant_email           TEXT NOT NULL,
  claimant_phone           TEXT,
  claimant_role            TEXT,
  message                  TEXT,
  status                   TEXT NOT NULL DEFAULT 'started',
  email_verified_at        TEXT,
  accept_code              TEXT UNIQUE,
  accept_code_expires_at   TEXT,
  reviewed_by              TEXT,
  reviewed_at              TEXT,
  reject_reason            TEXT,
  accepted_user_id         INTEGER REFERENCES users(id),
  ip                       TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS claim_otp_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id    INTEGER NOT NULL REFERENCES listing_claims(id),
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER,
  type        TEXT NOT NULL,
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_biz_town    ON businesses(town);
CREATE INDEX IF NOT EXISTS idx_events_town ON town_events(town, starts_at);
CREATE INDEX IF NOT EXISTS idx_users_business ON users(business_id);
CREATE INDEX IF NOT EXISTS idx_invites_business ON business_invitations(business_id, status);
CREATE INDEX IF NOT EXISTS idx_activity_business ON activity_log(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_claims_business ON listing_claims(business_id, status);
CREATE INDEX IF NOT EXISTS idx_claims_status   ON listing_claims(status, created_at);
CREATE INDEX IF NOT EXISTS idx_claim_otp_claim ON claim_otp_codes(claim_id, created_at);
CREATE INDEX IF NOT EXISTS idx_biz_claim_status ON businesses(claim_status);

-- Seeding a tenant (run scripts/hash-pin.mjs <pin> to get salt + pin_hash):
-- INSERT INTO businesses (slug,name,town,pin_hash,salt,modules,is_public)
-- VALUES ('titusville-mill','The Titusville Mill','titusville','<hash>','<salt>',
--   '{"herald":true,"drawbridge":true,"belltower":true,"hearth":true,"forge":false}', 1);
