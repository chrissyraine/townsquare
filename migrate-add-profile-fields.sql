-- Extends `businesses` with the yellow-pages profile fields the owner dashboard
-- needs that don't exist yet. Flat columns for scalars (matches existing blurb/
-- address/etc.); JSON only for genuinely list/grouped data (secondary_categories,
-- social_links), mirroring the existing `modules`/`product_slugs` JSON columns.
-- family_friendly/pet_friendly/appointment_required are nullable tri-state
-- (NULL = never answered, distinct from 0 = "no") so an unanswered profile never
-- shows a false negative badge publicly.
-- Run once; re-running errors harmlessly ("duplicate column") if already applied.
-- Apply locally:  wrangler d1 execute townsquare --local --file=migrate-add-profile-fields.sql
-- Apply remote:   wrangler d1 execute townsquare --remote --file=migrate-add-profile-fields.sql -y

ALTER TABLE businesses ADD COLUMN full_description TEXT;
ALTER TABLE businesses ADD COLUMN secondary_categories TEXT;      -- JSON array of strings
ALTER TABLE businesses ADD COLUMN service_area TEXT;
ALTER TABLE businesses ADD COLUMN public_contact_preference TEXT; -- 'phone'|'email'|'website'|'visit'
ALTER TABLE businesses ADD COLUMN social_links TEXT;              -- JSON {facebook,instagram,other}
ALTER TABLE businesses ADD COLUMN price_range TEXT;               -- '$'|'$$'|'$$$'|'$$$$'
ALTER TABLE businesses ADD COLUMN accessibility_info TEXT;
ALTER TABLE businesses ADD COLUMN parking_info TEXT;
ALTER TABLE businesses ADD COLUMN family_friendly INTEGER;        -- nullable tri-state
ALTER TABLE businesses ADD COLUMN pet_friendly INTEGER;           -- nullable tri-state
ALTER TABLE businesses ADD COLUMN appointment_required INTEGER;   -- nullable tri-state
ALTER TABLE businesses ADD COLUMN service_notes TEXT;
