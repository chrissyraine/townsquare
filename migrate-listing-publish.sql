-- Approving a listing submission must actually publish it into the `businesses`
-- registry (the directory the site reads). Record which row we created so that
-- un-approving pulls that exact row back out — and never touches a pre-existing
-- business that merely shares a name.
--
--   wrangler d1 execute townsquare --remote --file=migrate-listing-publish.sql -y

ALTER TABLE listing_submissions ADD COLUMN published_slug TEXT;
