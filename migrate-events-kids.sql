-- ONE-TIME migration: add the is_kids flag AND the source column to town_events.
-- Run ONCE:  wrangler d1 execute townsquare --remote --file=migrate-events-kids.sql -y
-- (Safe to re-run — if a column already exists it errors harmlessly on that line; ignore it.)
--   is_kids : 1 = kid/family-friendly (Kids calendar)
--   source  : 'curated' = managed in seed-events.sql | 'submitted' = came from the public form
ALTER TABLE town_events ADD COLUMN is_kids INTEGER NOT NULL DEFAULT 0;
ALTER TABLE town_events ADD COLUMN source TEXT NOT NULL DEFAULT 'curated';
