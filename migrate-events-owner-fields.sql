-- Extends `town_events` for owner-facing event management (richer fields +
-- cancellation distinct from unpublished-draft). is_canceled is separate from
-- is_published: a canceled, previously-published event stays visible with a
-- "Canceled" badge (per product spec) rather than disappearing; is_published=0
-- continues to mean "not visible at all" (draft/pending moderation).
-- Run once; re-running errors harmlessly ("duplicate column") if already applied.
-- Apply locally:  wrangler d1 execute townsquare --local --file=migrate-events-owner-fields.sql
-- Apply remote:   wrangler d1 execute townsquare --remote --file=migrate-events-owner-fields.sql -y

ALTER TABLE town_events ADD COLUMN audience TEXT;
ALTER TABLE town_events ADD COLUMN age_range TEXT;
ALTER TABLE town_events ADD COLUMN category TEXT;
ALTER TABLE town_events ADD COLUMN cost TEXT;
ALTER TABLE town_events ADD COLUMN registration_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE town_events ADD COLUMN registration_link TEXT;
ALTER TABLE town_events ADD COLUMN contact_info TEXT;
ALTER TABLE town_events ADD COLUMN image TEXT;                    -- URL only, Phase 1 (no upload)
ALTER TABLE town_events ADD COLUMN accessibility_notes TEXT;
ALTER TABLE town_events ADD COLUMN is_canceled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE town_events ADD COLUMN moderation_required INTEGER NOT NULL DEFAULT 0;
