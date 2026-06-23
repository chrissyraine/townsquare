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
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
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
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
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

-- Seeding a tenant (run scripts/hash-pin.mjs <pin> to get salt + pin_hash):
-- INSERT INTO businesses (slug,name,town,pin_hash,salt,modules,is_public)
-- VALUES ('titusville-mill','The Titusville Mill','titusville','<hash>','<salt>',
--   '{"herald":true,"drawbridge":true,"belltower":true,"hearth":true,"forge":false}', 1);
