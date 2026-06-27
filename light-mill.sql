-- Light up The Titusville Mill as an ACTIVE demo listing on the Square:
-- wire it to its real Drawbridge menu + Belltower booking so the card shows
-- "See menu" / "Reserve" and pulls live specials/open + next open slot.
UPDATE businesses
SET modules = '{"drawbridge":true,"belltower":true}', is_public = 1
WHERE slug = 'titusville-mill';
