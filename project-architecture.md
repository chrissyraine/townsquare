# TownSquare — Ecosystem Architecture

_Last updated: 2026-07-18 · Owner: Chrissy · Maintained by Claude Code_

This is the source-of-truth context doc for connecting the Forever Still Studio
ecosystem under **TownSquare**. Read this before touching code in any session.

---

## 1. The ecosystem (as-built, before TownSquare integration)

Five products, each a **fully independent app** — own Cloudflare Pages project,
own single advanced-mode `public/_worker.js` (no framework, no build step), own
**D1** database, own domain. **No shared codebase, no shared DB, no SSO today.**
Reuse is copy-pasted *pattern*, not a library.

**FIVE products live under the hub** (Herald, Drawbridge, Belltower, Hearth, **The
Forge**). The first four share the Cloudflare + PIN-auth + D1 pattern and are
brokerable. **The Forge is architecturally different** (Vercel, no PIN/D1 owner
login) — see §3a.

| Product | Domain | Stack | Owner surface | Owner login endpoint | Token claim (scope) |
| :-- | :-- | :-- | :-- | :-- | :-- |
| Herald | theherald.pages.dev | CF Pages + D1 | announcements/hours | `POST /api/auth/login` | (audit in Phase 1) |
| Drawbridge | getdrawbridge.app | CF Pages + D1 | Keep | `POST /api/auth/keep/login` | `keep` (audit) |
| Belltower | getbelltower.app | CF Pages + D1 | Belfry | `POST /api/auth/belfry/login` | `belfry` + `slug` |
| The Hearth | hearth-c7a.pages.dev (getthehearth.app pending) | CF Pages + D1 | Hall | `POST /api/auth/hall/login` | `hall` + `slug` |
| The Forge | gettheforge.app | Vercel (landing) + separate 3D engine | custom-order spec inbox | _none yet (not PIN/D1)_ | n/a — **not brokerable, see §3a** |
| TownSquare | gettownsquare.app (this app) | CF Pages + D1 (building) | the hub | _being built_ | n/a (issues own session) |

### Build state (do NOT treat as greenfield)
TownSquare's **React SPA already exists and runs** (Vite, default :5173). Already
built & working: `App.jsx` (session/localStorage), `Login.jsx` (3-way fan-out auth),
`Dashboard.jsx` (sidebar shell, 4 tabs), and **fully-implemented** `HeraldModule`,
`DrawbridgeModule`, `BelltowerModule` calling live product APIs, plus `SparkleTrail`
+ glass styling. **Hearth is a placeholder.** This integration **extends** that UI —
repoints module `fetch`es to the proxy and swaps in a TownSquare session — it does
**not** rewrite the existing modules.

**Shared auth pattern (identical-by-copy in all four products):** scrypt PIN hash
(`salt = 16 zero bytes`, N=16384, r=8, p=1), HMAC-signed expiring Bearer tokens
verified with a **per-app `SESSION_SECRET`**. A token minted by one app is **not**
valid on another. Multi-tenant by URL `slug`; each business is a separate row
**in each product's D1**, with its own `pin_hash`.

### The problem TownSquare solves
"One login" only works today if a business's slug **and** PIN are identical across
all five databases — hand-synced, fragile, and the thing that does **not** scale.
TownSquare replaces that with an owned identity + registry + token broker.

---

## 2. Decisions (locked 2026-06-23)

1. **Identity:** one TownSquare account that **brokers** access to each product.
   Each product still works **standalone** with its own PIN — brokering is purely
   additive; existing per-product logins are untouched.
2. **Token broker (refined shared-secret):** TownSquare's backend **custodies each
   product's existing `SESSION_SECRET`** and mints a **product-native token** per
   call, server-side. Same outcome as a shared secret (TownSquare can mint a token
   any product accepts) but **no changes to the four live products** and no forced
   logouts. _Future option: collapse to one literal shared secret if ever desired._
3. **Proxy:** product API calls route **through the TownSquare worker**
   (`gettownsquare.app/api/*`). Brokered tokens **never reach the browser** — the
   client holds only a TownSquare session cookie. The proxy is also where the
   loose-coupling contract and public-data caching live.
4. **Registry:** TownSquare-owned D1 table, **source of truth** for identity +
   module enrollment **and** the public "yellow pages." TownSquare owns slug issuance.
5. **Backend:** TownSquare gets its own Cloudflare Pages + `_worker.js` + D1,
   matching the house pattern. Production branch `production`. Domain `gettownsquare.app`.
6. **Module contract:** every module receives `{ slug, name }` and reaches its
   product **only through the proxy**; a module that fails **degrades its own tab**
   and never breaks the dashboard. Not-enrolled → **"Add this module" upsell** tab.
7. **Community app:** **per-town**, read-mostly aggregator. Flagship
   `titusvillesquare.com` (Titusville). v1 scope = **yellow-pages directory +
   live signals (specials/hours/announcements/open-slots/ratings) + a town-wide,
   owner-posted events calendar**. **No customer accounts/follows in v1.**

---

## 3. Identity & token-broker design

```
Browser (gettownsquare.app SPA)
   │  TownSquare session cookie only (httpOnly)
   ▼
TownSquare Worker  (public/_worker.js)
   ├── /api/auth/login            → verify against TownSquare registry (own pin_hash + per-account salt)
   ├── /api/session               → who am I, which modules enrolled
   ├── /api/herald/* ─┐
   ├── /api/drawbridge/* ─┤  PROXY: mint product-native token (custodied secret),
   ├── /api/belltower/* ─┤  attach as Bearer, forward to product API, normalize errors
   ├── /api/hearth/*  ─┘
   └── /api/public/*              → cached public projection for the town app
```

- TownSquare stores, as **Worker secrets**, each product's `SESSION_SECRET`
  (`HERALD_SECRET`, `DRAWBRIDGE_SECRET`, `BELLTOWER_SECRET`, `HEARTH_SECRET`).
- The broker replicates each product's exact `signToken({scope, slug}, secret, ttl)`
  claim shape — **read-only knowledge, no product edits**. Phase 1 audits the four
  claim shapes first.
- TownSquare accounts use a **proper per-account random salt** (fixing the static
  16-zero-byte salt for new identities) — see Tracked items.

## 3a. The Forge — the exception

The Forge does **not** fit the broker model: it's a Vercel-hosted landing plus a
separate white-label 3D customizer engine, with **no Cloudflare PIN/D1 owner login**
to mint a token against. So it cannot be brokered or proxied like the other four.

**v1 plan for Forge as a "module":** surface it as a **launch tile / deep-link**
(open the owner's Forge surface in a new tab) plus the **"Add this module" upsell**
for businesses that sell custom orders — not in-hub management. Giving Forge a real
brokered owner backend (a spec-inbox API on the house pattern) is a **later phase**,
decoupled from Phase 1. _Open question for Chrissy: confirm tile/deep-link for v1._

## Cross-app impact (guideline #1)
- **Phase-1 brokering requires NO *code* edits to Herald/Drawbridge/Belltower/Hearth.**
  The broker only needs each product's `{scope, slug}` token shape (audited) — no
  internal IDs, no handler changes.
- **BUT: Cloudflare Pages secrets are write-only.** Each product's existing
  production `SESSION_SECRET` can't be read back out, so "custody the existing
  secret" is impossible. The implemented path is the **literal shared secret**: set
  ONE freshly-generated secret as `SESSION_SECRET` on all four products **and**
  TownSquare's `HERALD/DRAWBRIDGE/BELLTOWER/HEARTH_SECRET`. This is a one-time
  `wrangler pages secret put` on each of the four live apps; the only effect is that
  currently-logged-in product owners must re-login once (old tokens stop verifying).
  Code unchanged; it's a config/secret rotation only.
- Each product's CORS already answers `/api/*` preflight `*`, so proxying works today.

---

## 4. Registry schema (TownSquare D1) — three consumers

The registry serves (a) the owner hub, (b) the token broker, (c) the public town app.
Keep a clean split between **private/auth**, **enrollment**, and **public profile**.

```
businesses
  id, slug (canonical, TownSquare-issued), name,
  town            -- e.g. 'titusville'  (per-town filter from day one)
  pin_hash, salt  -- TownSquare account auth (per-account salt)
  modules         -- JSON: { herald:true, drawbridge:true, belltower:false, hearth:true }
  product_slugs   -- JSON: optional per-product slug overrides (default = slug)
  -- public profile (the yellow pages projection):
  category, blurb, address, phone, website, logo, primary_color, is_public
  created_at

town_events       -- v1 community write-side (owner-posted)
  id, business_id, town, title, starts_at, ends_at, location, description, is_published

activity_log
  id, business_id, type, detail, created_at
```

- Public town app reads **only** a projection (`/api/public/directory?town=`,
  `/api/public/events?town=`) — never the auth columns.
- `town` on every row ⇒ adding a second town is a filter, not a re-architecture.

---

## 5. Community app (titusvillesquare.com)

Read-mostly **consumer** of the registry + the four products' existing public APIs;
products stay independent (loose coupling). Data sources:

| Source | Surfaces in town app | Status |
| :-- | :-- | :-- |
| Registry | Directory / business profiles (yellow pages) | building |
| Drawbridge | Today's specials, live menus (CORS-open) | public ✅ |
| Herald | "Who's open / what's new" announcements + hours | public ✅ |
| Belltower | Open slots / "reserve tonight" | public ✅ |
| Hearth | Aggregate rating / "top rated" | public projection ✅ |
| `town_events` | Town-wide events calendar (owner-posted) | v1 write-side |

**Upsell narrative:** an owner manages presence through tools they already use → it
auto-populates the town directory → free local discovery/foot traffic.

---

## 6. Phased plan

- **Phase 1 — Foundation:** TownSquare backend (worker + D1 + registry), token
  broker, proxy, TownSquare-session login, module-enrollment + upsell. _No edits to
  the four live products._ ✅ done.
- **Phase 2 — Hearth module:** wire the 5th module UI through the proxy. ✅ done.
- **Phase 3 — Community app:** public projection endpoints + `town_events` + the
  `titusvillesquare.com` frontend. ✅ done.
- **Phase 4 — Onboarding/provisioning:** admin to enroll businesses, "Add this
  module" write-side (creates the row in the target product's D1). Partial —
  self-serve enrollment isn't built; businesses currently onboard via the listing
  claim flow (§6a) or manual `/api/square/listings` admin actions.

### 6a. Owner dashboard + listing claims (shipped 2026-07-18)
A full owner-facing dashboard was built on top of the Phase 1-3 foundation —
this is the biggest single addition since the original phased plan above and
isn't reflected in it, so it gets its own entry:
- **Dashboard:** roles (OWNER/MANAGER/STAFF), dashboard home, business profile,
  hours, events (owner CRUD, 3-column grid), team/invites, public preview,
  activity log. Components: `DashboardHome.jsx`, `BusinessProfileEditor.jsx`,
  `HoursManager.jsx`, `EventsManager.jsx`, `TeamManager.jsx`, `PublicPreview.jsx`.
- **Security fix:** the legacy login flow auto-provisioned a full OWNER account to
  anyone who knew a business's PIN — including a placeholder PIN shared across
  216 seeded "PANEL" listings. Closed with a self-defending guard (refuses to
  auto-provision on a credential shared across multiple businesses) plus a full
  listing-claim flow (below) that replaces the shared PIN for real.
- **Listing claims:** public self-serve claim form (email OTP verify → admin
  review → approve/reject → accept-code redemption mints a fresh PIN). Tables:
  `listing_claims`, `claim_otp_codes`; `businesses.claim_status`. Public entry
  point: `titusvillesquare.com/claim-listing.html`. Admin review queue: the
  "Listing claims" section of `manage-events.html` (defaults to hiding
  approved/rejected claims — toggle "Show approved/rejected" to see them).
  Claiming a business **self-heals** the shared-PIN problem: `claim-accept`
  always mints a brand-new random-salt PIN, so the placeholder-PIN business
  count shrinks toward zero as real owners claim their listings — no bulk
  migration needed.

---

## 7. Tracked items / known issues
- **Static PIN salt** (16 zero bytes) in all four products — pre-existing. TownSquare
  accounts get a proper per-account salt now; product migration is out of v1 scope.
- **Admin PIN `04061982`** reused across products — note for future hardening.
- **Hearth custom domain** `getthehearth.app` + admin PIN still pending (per memory).
- **Token TTLs differ per product** (e.g. Hearth hall = 12h, Belltower belfry,
  Drawbridge keep) — broker must honor each product's TTL semantics.
- **Shared placeholder PIN** (216 seeded PANEL businesses) — largely resolved by
  the listing claim flow (§6a), which self-heals each business's credential the
  moment it's claimed. The Part A guard in `/api/auth/login` still blocks
  auto-provisioning for any business that hasn't been claimed yet.

---

## 8. Deployment (house convention)
- **Build first, then deploy `dist/` — NEVER `public/`.**
  ```
  npm run build
  npx wrangler pages deploy dist --project-name townsquare --branch production
  ```
  `public/` holds only `_worker.js` plus loose static files — no `index.html` and
  no bundled assets. Deploying it ships a site with no SPA at all. Vite copies
  `public/*` into `dist/` at build time, and `wrangler.toml` already declares
  `pages_build_output_dir = "dist"`. (This section said `public` until 2026-07-18;
  it was wrong, and is the same class of mistake as the deploy-root exposure fixed
  on eld-and-bjork and trinas-site that week.)
- **Cloudflare Pages, production branch = `production`.**
- Add `--commit-dirty=true` ONLY when knowingly deploying an unclean tree. Left
  off, a dirty-tree refusal is a useful warning that local edits are about to ship.
- Secrets via `wrangler pages secret put NAME --project-name townsquare`.
  Currently set: `SESSION_SECRET`, `HERALD_SECRET`, `DRAWBRIDGE_SECRET`,
  `BELLTOWER_SECRET`, `HEARTH_SECRET`, `MAILER_SECRET`, `PAYPAL_SECRET`,
  `AUDIT_IP_SALT`, `RESEND_API_KEY`, `EMAIL_DOMAIN` (2026-07-18, listing-claim
  OTP/approval emails — see `sendEmail()` in `_worker.js`; no-ops cleanly if unset).
- Local: `npm run dev:full` (= `wrangler pages dev dist --local --port 3010`);
  `.dev.vars` (gitignored). Build before running it, or you serve a stale `dist/`.
- Cloudflare account id `4990efc04eeb0c6e3f44ccc7f96a03dc`.

### Migration ledger
Migrations are plain SQL files run by hand — there is no migration runner, so this
list IS the record of what prod has. All are applied to the remote `townsquare` D1.

| File | Adds | Applied |
| :-- | :-- | :-- |
| `schema.sql` | base tables (businesses, town_events, activity_log, …) | baseline |
| `migrate-events-kids.sql` | `town_events.is_kids`, `.source` | ✅ 2026-07-01 |
| `migrate-add-source.sql` | `town_events.source` (overlaps the above) | ✅ 2026-07-01 |
| `migrate-join.sql` | self-serve signup columns | ✅ |
| `migrate-listings.sql` | `listing_submissions`, `listing_requests`, `form_hits` | ✅ |
| `migrate-add-profile-fields.sql` | yellow-pages profile columns | ✅ |
| `migrate-add-users-roles.sql` | `users`, `business_invitations` | ✅ |
| `migrate-events-owner-fields.sql` | owner-facing event columns | ✅ |
| `migrate-activity-index.sql` | activity_log index | ✅ |
| `migrate-audit-log.sql` | `audit_log` + 3 indexes | ✅ 2026-07-18 |
| `migrate-claims.sql` | `listing_claims`, `claim_otp_codes`, `businesses.claim_status`/`.claimed_at` | ✅ 2026-07-18 |

Every migration must be **additive** (`CREATE ... IF NOT EXISTS` / `ALTER TABLE
ADD COLUMN`). Never `DROP` or overwrite an existing table. Run `--local` first,
then `--remote` after review.

---

## 9. Audit log (internal-only)
`audit_log` records **every** D1 mutation: who, when, what, and which entity. It
exists because live records changed twice during read-only sessions (4 events
deleted, a business added) with no way to trace them. See `migrate-audit-log.sql`
for the schema and the privacy contract.

**It is not readable from any route.** No public endpoint, no Square, no owner
dashboard — by design, and a test in `test/integration/audit-log.test.js` sweeps
every read endpoint to keep it that way. **Do not add a read route.** Query it
with wrangler:

```bash
# everything in the last 24h, newest first
npx wrangler d1 execute townsquare --remote --command="SELECT ts, actor, action, entity_type, entity_id, summary FROM audit_log WHERE ts > datetime('now','-1 day') ORDER BY id DESC;"

# every destructive action, ever
npx wrangler d1 execute townsquare --remote --command="SELECT ts, actor, action, entity_id, summary FROM audit_log WHERE action LIKE '%delete%' OR action LIKE '%revoke%' ORDER BY id DESC;"

# full history of one record (e.g. town_events id 482)
npx wrangler d1 execute townsquare --remote --command="SELECT ts, actor, action, summary FROM audit_log WHERE entity_type='town_events' AND entity_id='482' ORDER BY id;"

# everything one actor did ('admin', 'public', 'system', or a business slug)
npx wrangler d1 execute townsquare --remote --command="SELECT ts, action, entity_type, entity_id, summary FROM audit_log WHERE actor='admin' ORDER BY id DESC LIMIT 50;"
```

Reading `actor`: a **business slug** = that tenant's session (the summary names the
user id + role); `admin` = whoever holds the shared titusville-square PIN — it
identifies the *role*, not the person, because that PIN is shared; `public` =
unauthenticated visitor; `system` = worker-initiated (e.g. cross-product
provisioning during signup).

**Coverage starts 2026-07-18T17:25Z.** Anything before that is not in this table —
use Cloudflare request logs or D1 time-travel for earlier incidents.

`ip_hash` is a keyed HMAC of the client IP (secret `AUDIT_IP_SALT`), truncated to
16 hex chars. **Do not rotate that secret** without accepting that hashes before
and after stop correlating. A plain digest was rejected deliberately: IPv4 is only
~4.3e9 values, so `sha256(ip)` is brute-forced back to the raw address in seconds.

### Retention: indefinite (decided 2026-07-18)

**Keep everything. No scheduled deletion, and no application code path that deletes
from `audit_log`** — pruning, if it is ever warranted, is manual and deliberate.

Sized against real numbers rather than instinct: the entire `townsquare` database
(234 businesses, 84 events, all tables) was **232 KB** when this was decided.
D1's ceiling is 10 GB. At the observed rate — roughly 30–60 rows/day, since
`audit_log` covers ~2–3× the paths `activity_log` does — and ~500 bytes/row
including its three indexes, that is **under 10 MB/year**. Storage is not the
constraint and will not be for the foreseeable life of this project.

Two reasons not to auto-prune, both stronger than the storage argument:

1. **Incidents here are discovered late.** The events that motivated this table
   were noticed well after the fact. Any retention window is a bet on detection
   lag — set it to 90 days, notice in month five, and the evidence is gone exactly
   when it is finally needed.
2. **An audit log that deletes itself undermines its own purpose.** The point is
   that destructive actions leave a trace; a scheduled job quietly destroying the
   record of destruction is the last process that should run unattended, and there
   is no volume pressure justifying the risk.

The real constraint is **readability, not bytes** — in an incident, thousands of
`auth.login` rows bury the one `event.delete`. That is a *query* problem, solved
by the filters above (`WHERE action LIKE '%delete%'`). Filter noise at read time;
never destroy data to make reading easier.

**Review trigger:** revisit at ~1M rows, or if D1 storage becomes a genuine
constraint — whichever comes first. If trimming is ever needed, trim the
high-volume/low-value actions first (`auth.login`, `broker.*.mutate`) and **never**
the destructive ones (`*.delete`, `*.revoke`, `team.role_change`,
`business.create`).

```bash
# check the review trigger
npx wrangler d1 execute townsquare --remote --command="SELECT COUNT(*) AS rows, MIN(ts) AS oldest FROM audit_log;"

# what is actually driving volume, if it ever matters
npx wrangler d1 execute townsquare --remote --command="SELECT action, COUNT(*) AS n FROM audit_log GROUP BY action ORDER BY n DESC;"
```

Watch `broker.*.mutate` — it fires on every non-GET request proxied to
Herald/Drawbridge/Belltower/Hearth, so it is the one action likely to dominate the
table if owners use their dashboards heavily. That makes it the first candidate to
trim, not a reason to prune now.
