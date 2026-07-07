-- Self-serve signup: add columns to the hub `businesses` table.
-- Apply once:
--   wrangler d1 execute townsquare --remote --file=migrate-join.sql -y
-- (SQLite ADD COLUMN has no IF NOT EXISTS — run this exactly once. Re-running errors harmlessly.)

ALTER TABLE businesses ADD COLUMN email TEXT;
ALTER TABLE businesses ADD COLUMN subscription_id TEXT;
ALTER TABLE businesses ADD COLUMN created_via TEXT;

-- Fast idempotency lookup by PayPal subscription id.
CREATE INDEX IF NOT EXISTS idx_biz_subscription ON businesses (subscription_id);
