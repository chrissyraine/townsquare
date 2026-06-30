# TownSquare — Ecosystem Architecture

_Last updated: 2026-06-23 · Owner: Chrissy · Maintained by Claude Code_

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
  the four live products._
- **Phase 2 — Hearth module:** wire the 5th module UI through the proxy.
- **Phase 3 — Community app:** public projection endpoints + `town_events` + the
  `titusvillesquare.com` frontend.
- **Phase 4 — Onboarding/provisioning:** admin to enroll businesses, "Add this
  module" write-side (creates the row in the target product's D1).

---

## 7. Tracked items / known issues
- **Static PIN salt** (16 zero bytes) in all four products — pre-existing. TownSquare
  accounts get a proper per-account salt now; product migration is out of v1 scope.
- **Admin PIN `04061982`** reused across products — note for future hardening.
- **Hearth custom domain** `getthehearth.app` + admin PIN still pending (per memory).
- **Token TTLs differ per product** (e.g. Hearth hall = 12h, Belltower belfry,
  Drawbridge keep) — broker must honor each product's TTL semantics.

---

## 8. Deployment (house convention)
- Cloudflare Pages, **production branch = `production`**:
  `wrangler pages deploy public --project-name townsquare --branch production --commit-dirty=true`
- Secrets via `wrangler pages secret put NAME --project-name townsquare`.
- Local: `wrangler pages dev public --port 3010 --local`; `.dev.vars` (gitignored).
- Cloudflare account id `4990efc04eeb0c6e3f44ccc7f96a03dc`.
