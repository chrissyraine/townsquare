-- Subscription state for the Founding 50 plan, used to gate PAID features.
-- Reuses the existing `subscription_id` column (populated by /api/public/join).
--   wrangler d1 execute townsquare --remote --file=migrate-subscription.sql -y
--
-- Two backfills matter enormously and must run WITH the ALTERs:
--   * comped        -> free forever, PayPal never touches them (community orgs + Chrissy's own)
--   * grandfathered -> every other pre-existing row, so nothing that works today stops working.
--     Without this, ~233 seeded businesses and 3 live client panels (warners-bakery,
--     missys-arcade, eld-and-bjork) would lose their paid features the moment gating ships.
-- After this migration a NULL status means "created later" and is NOT active by default —
-- the join and claim-pay flows set 'active' explicitly.

ALTER TABLE businesses ADD COLUMN subscription_status TEXT;
ALTER TABLE businesses ADD COLUMN subscription_plan_id TEXT;
ALTER TABLE businesses ADD COLUMN subscription_checked_at TEXT;

CREATE INDEX IF NOT EXISTS idx_biz_subscription_status ON businesses (subscription_status);

-- 1) Grandfather everything that already exists.
UPDATE businesses SET subscription_status = 'grandfathered' WHERE subscription_status IS NULL;

-- 2) Comped accounts: community organizations + Chrissy's own/managed listings.
UPDATE businesses SET subscription_status = 'comped' WHERE slug IN (
  'benson-memorial-library',
  'titusville-ywca',
  'titusville-ymca',
  'united-way-titusville',
  'titusville-council-arts',
  'claba',
  'associated-charities',
  'titusville-chamber',
  'titusville-square',
  'forever-still-studio',
  'forever-still-home',
  'cats-and-dogs-hotdogs'
);
