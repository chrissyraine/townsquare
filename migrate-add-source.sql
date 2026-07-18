-- Adds the 'source' column used by the Submit-an-Event form + approval queue.
-- Run ONCE:  wrangler d1 execute townsquare --remote --file=migrate-add-source.sql -y
-- (If it says the column already exists, that's fine - ignore it.)
ALTER TABLE town_events ADD COLUMN source TEXT NOT NULL DEFAULT 'curated';
