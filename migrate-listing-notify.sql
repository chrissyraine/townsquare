-- Track when a submitter was told their listing went live, so re-approving an edited
-- listing doesn't email them "you're live!" a second (and third) time.
--   wrangler d1 execute townsquare --remote --file=migrate-listing-notify.sql -y

ALTER TABLE listing_submissions ADD COLUMN notified_live_at TEXT;
