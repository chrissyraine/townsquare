-- activity_log already has the right shape (id, business_id, type, detail,
-- created_at) but was unused until the Phase 1 owner dashboard started writing
-- real rows on every mutation. This index supports the read pattern used by
-- GET /api/activity and GET /api/business/home (recent-first, per business).
-- Apply locally:  wrangler d1 execute townsquare --local --file=migrate-activity-index.sql
-- Apply remote:   wrangler d1 execute townsquare --remote --file=migrate-activity-index.sql -y

CREATE INDEX IF NOT EXISTS idx_activity_business ON activity_log(business_id, created_at DESC);
