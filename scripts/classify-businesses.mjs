// Classify existing businesses into the directory taxonomy.
//   node scripts/classify-businesses.mjs
//
// Emits:
//   migrate-taxonomy-backfill.sql  — one guarded UPDATE per legacy category string
//   category-review.md             — everything an admin should eyeball
//
// Ground rules (mirrors the migration spec):
//   * Deterministic: keyed on the EXACT legacy `category` string, not fuzzy matching.
//   * Idempotent + non-destructive: every UPDATE carries `AND primary_category IS NULL`,
//     so re-running never overwrites a choice an owner or admin has since made.
//   * Honest: uncertain rows get a broad primary only (sub NULL) and land on the
//     review list; rows we can't support at all stay NULL and appear in the admin
//     review queue. NOTHING is invented.
//
// The mapping below covers all 160 distinct category values present in prod on
// 2026-07-20 (dump: SELECT category, COUNT(*) FROM businesses GROUP BY category).
// Categories that appear later (new signups type free text) simply stay NULL and
// show up in the admin review queue — that's the designed path, not a failure.

import { writeFileSync } from 'fs';

// [primary, sub, review?]  sub=null → "broad primary only".  review → needs human eyes.
const MAP = {
  // ── Eat & Drink ──────────────────────────────────────────────────────────
  'Restaurant': ['eat-drink', 'restaurants'],
  'Family Restaurant': ['eat-drink', 'restaurants'],
  'Diner': ['eat-drink', 'restaurants'],
  'Eatery': ['eat-drink', 'restaurants'],
  'Italian Eatery': ['eat-drink', 'restaurants'],
  'Italian Restaurant': ['eat-drink', 'restaurants'],
  'Mexican Restaurant': ['eat-drink', 'restaurants'],
  'Chinese Buffet': ['eat-drink', 'restaurants'],
  'Polish & Comfort Food': ['eat-drink', 'restaurants'],
  'Steakhouse & Brewery': ['eat-drink', 'restaurants'],
  'Soup, Salad & Sandwiches': ['eat-drink', 'restaurants'],
  'Pizza & Italian': ['eat-drink', 'restaurants'],
  'Arcade & Eatery': ['eat-drink', 'restaurants'],
  'Bar & Grill': ['eat-drink', 'bars-nightlife'],
  'Brewery': ['eat-drink', 'bars-nightlife'],
  'Coffee Shop': ['eat-drink', 'cafes-coffee'],
  'Bakery & Café': ['eat-drink', 'bakeries-desserts'],
  'Ice Cream Shop': ['eat-drink', 'bakeries-desserts'],
  'Fast Food': ['eat-drink', 'takeout-fast-food'],
  'Pizza': ['eat-drink', 'takeout-fast-food'],
  'Pizza & Wings': ['eat-drink', 'takeout-fast-food'],
  'Hot Dog Shop': ['eat-drink', 'takeout-fast-food'],
  'Hot Dog Stand': ['eat-drink', 'takeout-fast-food'],
  'Sandwiches': ['eat-drink', 'takeout-fast-food'],
  'Lunch Counter': ['eat-drink', 'takeout-fast-food'],
  'Candy Shop': ['eat-drink', 'specialty-food'],
  'Candy & Gifts': ['eat-drink', 'specialty-food'],
  'Dairy Maker': ['eat-drink', 'specialty-food'],
  'Food & Drink': ['eat-drink', null, 'too generic to pick a subcategory'],

  // ── Stay ─────────────────────────────────────────────────────────────────
  'Hotel': ['stay', 'hotels'],
  'Motel': ['stay', 'hotels'],
  'Resort': ['stay', 'hotels'],
  'Bed & Breakfast': ['stay', 'inns-bnb'],
  'Campground': ['stay', 'campgrounds'],

  // ── Shop ─────────────────────────────────────────────────────────────────
  'Boutique': ['shop', 'clothing-accessories'],
  'Clothing Store': ['shop', 'clothing-accessories'],
  "Women's Clothing": ['shop', 'clothing-accessories'],
  'Jeweler': ['shop', 'clothing-accessories'],
  'Gift Shop': ['shop', 'gifts-specialty'],
  'Specialty Shop': ['shop', 'gifts-specialty'],
  'Resale Shop': ['shop', 'antiques-vintage'],
  'Thrift Store': ['shop', 'antiques-vintage'],
  'Home Decor': ['shop', 'home-garden'],
  'Convenience & Gas': ['shop', 'grocery-markets'],
  'Discount & Grocery': ['shop', 'grocery-markets'],
  'Discount Grocery': ['shop', 'grocery-markets'],
  'Grocery & Meats': ['shop', 'grocery-markets'],
  'Indoor Market': ['shop', 'grocery-markets'],
  'Supermarket': ['shop', 'grocery-markets'],
  'Beer Distributor': ['shop', 'grocery-markets'],
  'State Store': ['shop', 'grocery-markets', 'PA liquor store — confirm grouping under Grocery & Markets'],
  'Fabric & Blankets': ['shop', 'books-art-hobbies'],
  'Music': ['shop', 'books-art-hobbies', 'both rows look like music stores (incl. Fernwood Music) — confirm neither is a lessons studio'],
  'Building Supply': ['shop', 'hardware-supplies'],
  'Farm & Ranch': ['shop', 'hardware-supplies'],
  'Hardware Store': ['shop', 'hardware-supplies'],
  'Florist': ['shop', 'florists'],
  'Florist & Gifts': ['shop', 'florists'],
  'Discount Store': ['shop', null, 'general discount store — no clean subcategory'],
  'Sporting Goods': ['shop', null, 'no sporting-goods subcategory in the taxonomy'],
  'General & Sporting Goods': ['shop', null, 'no sporting-goods subcategory in the taxonomy'],
  'Firearms': ['shop', null, 'no clean subcategory'],
  'Retail Marketplace': ['shop', null, 'too generic to pick a subcategory'],
  'Shops & Retail': ['shop', null, 'too generic to pick a subcategory'],
  'Wireless Store': ['shop', null, 'phone stores sell goods, but confirm these are not repair shops (→ Marketing & Technology)'],

  // ── Things to Do ─────────────────────────────────────────────────────────
  'Bowling': ['things-to-do', 'entertainment'],
  'Escape Room': ['things-to-do', 'entertainment'],
  'Roller Rink': ['things-to-do', 'family-activities'],
  'Community Theater': ['things-to-do', 'arts-culture'],
  'Dance Studio': ['things-to-do', 'arts-culture'],
  'Music School': ['things-to-do', 'arts-culture'],
  'Golf Course': ['things-to-do', 'recreation-outdoors'],
  'Museum': ['things-to-do', 'museums-history'],
  'Heritage Railroad': ['things-to-do', 'tours-experiences'],
  'Tour Operator': ['things-to-do', 'tours-experiences'],
  'Orchard': ['things-to-do', null, 'pick-your-own vs farm stand — could belong under Shop › Grocery & Markets instead'],

  // ── Beauty & Wellness ────────────────────────────────────────────────────
  'Hair Salon': ['beauty-wellness', 'hair-beauty'],
  'Beauty Salon': ['beauty-wellness', 'hair-beauty'],
  'Nail Salon': ['beauty-wellness', 'hair-beauty'],
  'Salon': ['beauty-wellness', 'hair-beauty'],
  'Salon & Boutique': ['beauty-wellness', 'hair-beauty'],
  'Salon & Tanning': ['beauty-wellness', 'hair-beauty'],
  'Tanning Salon': ['beauty-wellness', 'hair-beauty'],
  'Tattoo & Piercing': ['beauty-wellness', 'hair-beauty'],
  'Day Spa': ['beauty-wellness', 'spas-massage'],
  'Day Spa & Yoga': ['beauty-wellness', 'spas-massage'],
  'Massage Therapy': ['beauty-wellness', 'spas-massage'],
  'Audiologist': ['beauty-wellness', 'medical-dental'],
  'Chiropractor': ['beauty-wellness', 'medical-dental'],
  'Dentist': ['beauty-wellness', 'medical-dental'],
  'Hospital': ['beauty-wellness', 'medical-dental'],
  'Internal Medicine': ['beauty-wellness', 'medical-dental'],
  'Medical Clinic': ['beauty-wellness', 'medical-dental'],
  'Optometrist': ['beauty-wellness', 'medical-dental'],
  'Orthopedics': ['beauty-wellness', 'medical-dental'],
  'Pediatrician': ['beauty-wellness', 'medical-dental'],
  'Physical Therapy': ['beauty-wellness', 'medical-dental'],
  'Podiatrist': ['beauty-wellness', 'medical-dental'],
  'Urgent Care': ['beauty-wellness', 'medical-dental'],
  'Nursing & Rehab': ['beauty-wellness', 'medical-dental', 'skilled nursing — possibly Community › Senior & Veteran Services'],
  'Hospice Care': ['beauty-wellness', 'medical-dental', 'possibly Community › Senior & Veteran Services'],
  'Pharmacy': ['beauty-wellness', 'pharmacies'],

  // ── Home & Auto ──────────────────────────────────────────────────────────
  'Auto Body': ['home-auto', 'automotive'],
  'Auto Detailing': ['home-auto', 'automotive'],
  'Auto Parts': ['home-auto', 'automotive'],
  'Auto Repair': ['home-auto', 'automotive'],
  'Auto Repair & Tires': ['home-auto', 'automotive'],
  'Auto Repair & Towing': ['home-auto', 'automotive'],
  'Auto Restoration': ['home-auto', 'automotive'],
  'Car Dealership': ['home-auto', 'automotive'],
  'Car Wash': ['home-auto', 'automotive'],
  'Motorcycle Shop': ['home-auto', 'automotive'],
  'RV Dealer': ['home-auto', 'automotive'],
  'Tire Shop': ['home-auto', 'automotive'],
  'Used Cars': ['home-auto', 'automotive'],
  'Flooring': ['home-auto', 'contractors-repair'],
  'Garage Doors': ['home-auto', 'contractors-repair'],
  'Home Improvement': ['home-auto', 'contractors-repair'],
  'Home Restoration & Carpentry': ['home-auto', 'contractors-repair'],
  'Painter': ['home-auto', 'contractors-repair'],
  'Pools': ['home-auto', 'contractors-repair'],
  'Electrician': ['home-auto', 'plumbing-heating-electrical'],
  'HVAC': ['home-auto', 'plumbing-heating-electrical'],
  'Heating & Cooling': ['home-auto', 'plumbing-heating-electrical'],
  'Plumbing & HVAC': ['home-auto', 'plumbing-heating-electrical'],
  'Excavating & Landscape': ['home-auto', 'landscaping'],
  'Tree Service': ['home-auto', 'landscaping'],
  'Cleaning Service': ['home-auto', 'cleaning-property'],
  'Real Estate': ['home-auto', 'real-estate'],
  'Real Estate & Title': ['home-auto', 'real-estate'],
  'Furniture & Appliances': ['home-auto', 'furniture-appliances'],
  'Mattress Store': ['home-auto', 'furniture-appliances'],

  // ── Local Services ───────────────────────────────────────────────────────
  'Attorney': ['local-services', 'legal-financial'],
  'Law Firm': ['local-services', 'legal-financial'],
  'Elder Law & Estate': ['local-services', 'legal-financial'],
  'Bank': ['local-services', 'legal-financial'],
  'Credit Union': ['local-services', 'legal-financial'],
  'CPA & Accounting': ['local-services', 'legal-financial'],
  'Financial Advisor': ['local-services', 'legal-financial'],
  'Tax & Accounting': ['local-services', 'legal-financial'],
  'Tax Services': ['local-services', 'legal-financial'],
  'Insurance Agency': ['local-services', 'insurance'],
  'Photography': ['local-services', 'photography-creative'],
  'Commercial Printing': ['local-services', 'printing-signs'],
  'Print & Design': ['local-services', 'printing-signs'],
  'Printing': ['local-services', 'printing-signs'],
  'Computer Repair': ['local-services', 'marketing-technology'],
  'Pet Groomer': ['local-services', 'pet-services'],
  'Veterinarian': ['local-services', 'pet-services'],
  'Funeral Home': ['local-services', 'personal-business'],
  'Laundromat': ['local-services', 'personal-business'],
  'Self Storage': ['local-services', 'personal-business'],
  'Services': ['local-services', null, 'too generic to pick a subcategory'],

  // ── Community ────────────────────────────────────────────────────────────
  'Community Organization': ['community', 'nonprofits'],
  'Library': ['community', 'libraries'],
  'Community': ['community', null, 'too generic to pick a subcategory'],
  'Community Center': ['community', null, 'clubs/civic vs government — confirm'],
  'Community Hub': ['community', null, 'too generic to pick a subcategory'],
  'Personal Care Home': ['community', 'senior-veteran', 'senior living — confirm vs Beauty & Wellness › Medical & Dental'],

  // ── Events & Venues ──────────────────────────────────────────────────────
  'Event Venue': ['events-venues', 'event-venues'],
};

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const lines = [
  '-- GENERATED by scripts/classify-businesses.mjs — do not hand-edit; edit the MAP and re-run.',
  '-- Idempotent + non-destructive: only ever fills NULLs, never overwrites a set value.',
  '--   wrangler d1 execute townsquare --remote --file=migrate-taxonomy-backfill.sql -y',
  '',
];
const review = [
  '# Directory classification — manual review list',
  '',
  'Generated by `scripts/classify-businesses.mjs`. Two kinds of entries:',
  '',
  '1. **Broad-only / double-check** — assigned a primary category the listing text',
  '   strongly supports, but the subcategory was left blank or the grouping is debatable.',
  '2. **Unclassified** — no assignment at all; these stay NULL and appear in the admin',
  '   review queue on manage-events.html until a human sets them.',
  '',
  'Nothing was invented: where the legacy category could not support a confident call,',
  'the field was left blank rather than guessed.',
  '',
  '## Broad-only / double-check',
  '',
];

let mapped = 0, flagged = 0;
for (const [legacy, [primary, sub, note]] of Object.entries(MAP)) {
  lines.push(
    `UPDATE businesses SET primary_category=${q(primary)}, subcategory=${sub ? q(sub) : 'NULL'}` +
    ` WHERE category=${q(legacy)} AND primary_category IS NULL;`
  );
  mapped++;
  if (note) {
    review.push(`- **${legacy}** → \`${primary}\`${sub ? ' › `' + sub + '`' : ' (no subcategory)'} — ${note}`);
    flagged++;
  }
}

review.push(
  '',
  '## Unclassified (stay NULL → admin review queue)',
  '',
  '- Any business whose `category` is NULL or empty (1 known in prod).',
  '- Any future category string not in the MAP (new self-serve signups type free text).',
  '',
  'Find them any time with:',
  '```sql',
  "SELECT slug, name, category FROM businesses WHERE primary_category IS NULL AND is_public=1;",
  '```',
);

writeFileSync(new URL('../migrate-taxonomy-backfill.sql', import.meta.url), lines.join('\n') + '\n');
writeFileSync(new URL('../category-review.md', import.meta.url), review.join('\n') + '\n');
console.log(`backfill: ${mapped} category strings mapped, ${flagged} flagged for review`);
console.log('wrote migrate-taxonomy-backfill.sql and category-review.md');
