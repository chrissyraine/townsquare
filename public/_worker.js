// TownSquare — hub backend (Cloudflare Pages, advanced-mode _worker.js).
// Vite copies public/_worker.js -> dist/_worker.js, where Pages runs it in
// advanced mode: this worker handles /api/*, everything else is served from the
// built SPA via env.ASSETS.
//
// What it does:
//   - TownSquare-owned auth/session over its OWN registry (per-account salt).
//   - Token BROKER + PROXY to the product apps (Herald/Drawbridge/Belltower/Hearth).
//   - Public yellow-pages directory + town events (read-only projection).
//
// Brokering (audited 2026-06-23): every product verifies a token signed with ITS
// OWN SESSION_SECRET and authorizes on { scope, slug } only — the internal row ids
// embedded in product tokens (bid/rid) are IGNORED by every auth guard, and each
// protected handler re-queries the business by slug. So TownSquare custodies each
// product's secret and mints a product-native token per request. NO product edits.
//
// Token formats reproduced byte-for-byte:
//   Herald/Drawbridge/Belltower : exp in ms,  signature base64url
//   Hearth                      : exp in sec, signature hex

import { createHmac, scryptSync, timingSafeEqual, randomBytes } from 'crypto';

const PRODUCTS = {
  herald:     { origin: 'https://theherald.pages.dev', scope: 'business', secret: 'HERALD_SECRET',     fmt: 'ms'  },
  drawbridge: { origin: 'https://getdrawbridge.app',   scope: 'keep',     secret: 'DRAWBRIDGE_SECRET', fmt: 'ms'  },
  belltower:  { origin: 'https://getbelltower.app',    scope: 'belfry',   secret: 'BELLTOWER_SECRET',  fmt: 'ms'  },
  hearth:     { origin: 'https://hearth-c7a.pages.dev', scope: 'hall',    secret: 'HEARTH_SECRET',     fmt: 'sec' },
  // forge is NOT brokered — it's a launch-tile/deep-link only (see project-architecture.md §3a)
};
const TTL_MS = 12 * 3600 * 1000;
// Town-feed event window. Bounded by TIME, not by a row count: a fixed LIMIT silently
// hides whatever falls past it and the cut-off drifts as events are added — a plain
// `LIMIT 50` hid 9 already-published events in Jul 2026 (59 upcoming, feed stopped at 50).
// Six months is further ahead than a town calendar is realistically browsed, and the
// window self-maintains as time passes. EVENT_CAP is a payload backstop only: it is far
// above real volume (~59 upcoming across two months when this was written) and is not
// expected to be hit. If it ever is, that is a signal to page the calendar, not to raise it.
const EVENT_WINDOW = '+6 months';
const EVENT_CAP = 500;
// Public PayPal client-id (same one already on the join.html subscribe button). The
// paired *secret* is set as a Worker secret (PAYPAL_SECRET); env can override this id.
const PAYPAL_LIVE_CLIENT_ID = 'Ab48DLR-FRpiFhHrgbRZUv8JxyhQ1u9jl_aPrBC4Yd6AkYu-Z4ck8I6iiRd-miZFCyFUq3TSPcs0D6EJ';

// Directory taxonomy — slugs-only mirror of titusvillesquare/public/taxonomy.js,
// used purely to VALIDATE what owners/admins write. Display titles, icons and
// descriptions live client-side in taxonomy.js; keep the two slug sets in sync.
const TAXONOMY = {
  'eat-drink': ['restaurants', 'cafes-coffee', 'bakeries-desserts', 'bars-nightlife', 'takeout-fast-food', 'catering', 'specialty-food'],
  'stay': ['hotels', 'inns-bnb', 'vacation-rentals', 'campgrounds', 'extended-stay'],
  'shop': ['clothing-accessories', 'gifts-specialty', 'antiques-vintage', 'home-garden', 'grocery-markets', 'books-art-hobbies', 'hardware-supplies', 'florists'],
  'things-to-do': ['attractions', 'arts-culture', 'recreation-outdoors', 'entertainment', 'family-activities', 'museums-history', 'tours-experiences'],
  'beauty-wellness': ['hair-beauty', 'spas-massage', 'fitness', 'medical-dental', 'counseling-wellness', 'pharmacies'],
  'home-auto': ['contractors-repair', 'cleaning-property', 'landscaping', 'real-estate', 'automotive', 'plumbing-heating-electrical', 'furniture-appliances'],
  'local-services': ['legal-financial', 'insurance', 'marketing-technology', 'photography-creative', 'printing-signs', 'pet-services', 'personal-business'],
  'community': ['nonprofits', 'churches-faith', 'schools-childcare', 'libraries', 'government-public', 'clubs-civic', 'senior-veteran'],
  'events-venues': ['event-venues', 'wedding-services', 'party-rentals', 'live-entertainment', 'event-planning'],
};
// Family Friendly / Pet Friendly / Appointment Required live in dedicated columns,
// so they are deliberately absent here — the tags column never duplicates them.
const TAXONOMY_TAGS = new Set([
  'Kid Friendly', 'Veteran Owned', 'Woman Owned', 'Locally Made', 'Outdoor Seating',
  'Accessible', 'Delivery', 'Takeout', 'Open Late', 'Free Admission',
]);
// Returns {primary, subcategory, tags} normalized, or {error} if invalid.
function validateTaxonomy(primary, subcategory, tags) {
  const p = primary == null || primary === '' ? null : String(primary);
  if (p !== null && !TAXONOMY[p]) return { error: 'invalid_primary_category' };
  let s = subcategory == null || subcategory === '' ? null : String(subcategory);
  // A subcategory only means something inside its primary; without one it's noise.
  if (s !== null && (p === null || !TAXONOMY[p].includes(s))) return { error: 'invalid_subcategory' };
  let t = null;
  if (tags !== undefined && tags !== null) {
    if (!Array.isArray(tags)) return { error: 'invalid_tags' };
    t = [...new Set(tags.map(String))].filter((x) => TAXONOMY_TAGS.has(x)).slice(0, 10);
  }
  return { primary: p, subcategory: s, tags: t };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await api(request, env, url); }
      catch (err) { return json({ error: 'server_error', detail: String(err) }, 500); }
    }
    return env.ASSETS.fetch(request); // the built SPA
  },
};

// Admin gate for event management: the PIN must match the titusville-square account.
async function squareOk(pin, env) {
  if (!pin) return false;
  const biz = await env.DB.prepare("SELECT salt,pin_hash FROM businesses WHERE slug='titusville-square'").first();
  if (!biz) return false;
  try { return verifyPin(String(pin), biz.salt, biz.pin_hash); } catch { return false; }
}

async function api(request, env, url) {
  const path = url.pathname;
  const method = request.method;
  if (method === 'OPTIONS') return new Response(null, { headers: cors() });

  // ---- auth: login (sets httpOnly session cookie; no token reaches JS) ----
  // Team members (Phase 1, PIN-based): a business can now have several active
  // PINs — the OWNER's original one plus one per invited teammate, each hashed
  // with its own random salt in `users`. Login tries every active member's PIN
  // and mints a session for whichever one matches (scrypt equality, so this is
  // the only way to tell them apart). Legacy fallback below covers a business
  // that has no `users` rows yet (hasn't logged in since this shipped).
  if (path === '/api/auth/login' && method === 'POST') {
    const { slug, pin } = await readBody(request);
    // Accept the Business ID *or* the email on file. Owners reliably remember their
    // email; a slug they saw once on a signup screen they do not. PIN check unchanged.
    const ident = String(slug || '').trim();
    const biz = await env.DB.prepare(
      'SELECT * FROM businesses WHERE slug=? OR (email IS NOT NULL AND lower(email)=lower(?)) LIMIT 1'
    ).bind(ident, ident).first();
    if (!biz) return json({ error: 'invalid_login' }, 401);

    const members = await env.DB.prepare(
      'SELECT id, role, pin_hash, salt FROM users WHERE business_id=? AND is_active=1'
    ).bind(biz.id).all();
    let user = null;
    for (const m of members.results || []) {
      if (verifyPin(pin, m.salt, m.pin_hash)) { user = m; break; }
    }

    if (!user) {
      // No `users` row matched (most likely there are none yet). Fall back to the
      // original businesses.pin_hash check, then lazily provision an OWNER row
      // reusing that SAME hash/salt — the PIN never changes for existing tenants.
      if (!verifyPin(pin, biz.salt, biz.pin_hash)) return json({ error: 'invalid_login' }, 401);
      let owner = await env.DB.prepare(
        "SELECT id, role FROM users WHERE business_id=? AND role='OWNER' AND is_active=1 ORDER BY id LIMIT 1"
      ).bind(biz.id).first();
      if (!owner) {
        // Refuse to auto-provision on a credential shared across multiple businesses —
        // several dozen seeded "PANEL" listings share one placeholder PIN, and without
        // this guard, knowing that one shared PIN grants full OWNER access to any of
        // them. Self-defending (no hardcoded hash) so it survives a future reseed under
        // a different placeholder. Real per-account credentials are unique by design, so
        // this never blocks a legitimately-onboarded business.
        const shared = await env.DB.prepare(
          'SELECT COUNT(*) AS c FROM businesses WHERE pin_hash=? AND salt=?'
        ).bind(biz.pin_hash, biz.salt).first();
        if (shared && shared.c > 1) {
          await audit(env, request, {
            actor: biz.slug, action: 'auth.autoprovision_blocked', entity_type: 'businesses', entity_id: biz.id,
            summary: `login PIN matched a credential shared across ${shared.c} businesses — refused to auto-provision OWNER`,
          });
          return json({ error: 'not_yet_claimed' }, 403);
        }
        await env.DB.prepare(
          "INSERT INTO users (business_id, name, pin_hash, salt, role) VALUES (?,?,?,?,'OWNER')"
        ).bind(biz.id, biz.name, biz.pin_hash, biz.salt).run();
        owner = await env.DB.prepare(
          "SELECT id, role FROM users WHERE business_id=? AND role='OWNER' AND is_active=1 ORDER BY id LIMIT 1"
        ).bind(biz.id).first();
        await audit(env, request, {
          actor: biz.slug, action: 'user.autoprovision', entity_type: 'users', entity_id: owner && owner.id,
          summary: 'OWNER row created from legacy business PIN on first login',
        });
      }
      user = owner;
    }

    await env.DB.prepare("UPDATE users SET last_login_at=datetime('now') WHERE id=?").bind(user.id).run();
    await logActivity(env, biz.id, 'login', user.role);
    await audit(env, request, {
      actor: biz.slug, action: 'auth.login', entity_type: 'users', entity_id: user.id,
      summary: `login as ${user.role}`,
    });

    const session = signClassic({ slug: biz.slug, exp: Date.now() + TTL_MS, uid: user.id, role: user.role }, env.SESSION_SECRET);
    // Login is the natural place to re-check a stale subscription (no webhooks in v1).
    // Best-effort: never blocks or fails the login.
    let bizAfter = biz;
    try { bizAfter = await refreshSubscription(env, biz); } catch { /* keep stored status */ }
    // `token` lets a cross-origin owner UI (e.g. titusvillesquare.com/manage.html) authenticate
    // via Authorization: Bearer, since the httpOnly cookie can't ride cross-site.
    return json(
      {
        slug: biz.slug, name: biz.name, town: biz.town, modules: parse(biz.modules, {}),
        role: user.role, userId: user.id, token: session,
        subscription_status: bizAfter.subscription_status || null,
        subscription_active: subscriptionActive(bizAfter),
      },
      200,
      { 'Set-Cookie': cookie('ts_session', session, TTL_MS / 1000) }
    );
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': cookie('ts_session', '', 0) });
  }

  // ---- who am I ----
  if (path === '/api/session' && method === 'GET') {
    const s = sessionFrom(request, env);
    if (!s) return json({ error: 'unauthenticated' }, 401);
    const biz = await env.DB.prepare(
      'SELECT slug,name,town,modules,subscription_status FROM businesses WHERE slug=?'
    ).bind(s.slug).first();
    if (!biz) return json({ error: 'unauthenticated' }, 401);
    let userName = null;
    if (s.uid) {
      // Pre-migration tokens (signed before this deploy) won't carry `uid` — treat
      // that as "not a v2 session" rather than crash; the UI just won't know a role
      // until the owner logs in again (tokens expire naturally within TTL_MS).
      const user = await env.DB.prepare('SELECT name, is_active FROM users WHERE id=?').bind(s.uid).first();
      if (!user || !user.is_active) return json({ error: 'unauthenticated' }, 401);
      userName = user.name;
    }
    return json({
      slug: biz.slug, name: biz.name, town: biz.town, modules: parse(biz.modules, {}),
      role: s.role || null, userId: s.uid || null, userName,
      subscription_status: biz.subscription_status || null,
      subscription_active: subscriptionActive(biz),
    });
  }

  // ---- public yellow-pages (no auth) ----
  if (path === '/api/public/directory' && method === 'GET') {
    const town = url.searchParams.get('town') || 'titusville';
    const rows = await env.DB.prepare(
      'SELECT slug,name,category,blurb,address,phone,website,logo,primary_color,forge_url,modules,subscription_status,primary_category,subcategory,tags FROM businesses WHERE town=? AND is_public=1 ORDER BY name'
    ).bind(town).all();
    // The basic listing always publishes; only the paid `modules` map is withheld while
    // inactive, so a lapsed business stays fully findable in the directory.
    return json({
      town,
      businesses: (rows.results || []).map(({ subscription_status, ...b }) => ({
        ...b,
        tags: parse(b.tags, []),
        modules: subscriptionActive({ subscription_status }) ? parse(b.modules, {}) : {},
      })),
    });
  }
  if (path === '/api/public/events' && method === 'GET') {
    const town = url.searchParams.get('town') || 'titusville';
    const rows = await env.DB.prepare(
      `SELECT id,title,starts_at,ends_at,location,description,is_kids,is_canceled,audience,age_range,
              category,cost,registration_required,registration_link,contact_info,image,accessibility_notes
       FROM town_events WHERE town=? AND is_published=1 AND starts_at >= datetime('now','-1 day') ORDER BY starts_at`
    ).bind(town).all();
    return json({ town, events: rows.results || [] });
  }

  // ---- public: submit an event (lands as a hidden draft for review) ----
  if (path === '/api/public/events/submit' && method === 'POST') {
    const b = await readBody(request);
    if (b && b.hp) return json({ ok: true }); // honeypot: silently drop bots
    const title = String(b.title || '').trim().slice(0, 120);
    const starts_at = String(b.starts_at || '').trim().slice(0, 16);
    if (!title || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(starts_at)) {
      return json({ error: 'A title and a valid date/time are required.' }, 400);
    }
    const ends_at = String(b.ends_at || '').trim().slice(0, 16) || null;
    const location = String(b.location || '').trim().slice(0, 120) || null;
    let description = String(b.description || '').trim().slice(0, 600) || null;
    const submitter = String(b.submitter || '').trim().slice(0, 160);
    if (submitter) description = `${description || ''}\n\n— submitted by ${submitter}`.trim();
    const is_kids = b.is_kids ? 1 : 0;
    const town = String(b.town || 'titusville');
    const insEv = await env.DB.prepare(
      "INSERT INTO town_events (town, title, starts_at, ends_at, location, description, is_published, is_kids, source) VALUES (?,?,?,?,?,?,0,?, 'submitted')"
    ).bind(town, title, starts_at, ends_at, location, description, is_kids).run();
    // Submitter name/contact is deliberately NOT audited — it's free-text PII that
    // the public form collects. The event title and row id are enough to trace it.
    await audit(env, request, {
      actor: 'public', action: 'event.submit', entity_type: 'town_events', entity_id: insEv.meta.last_row_id,
      summary: `public event draft submitted: "${title}" (${town}, unpublished)`,
    });
    return json({ ok: true });
  }

  // ---- public: self-serve signup — verify payment, then provision across products ----
  if (path === '/api/public/join' && method === 'POST') {
    const b = await readBody(request);
    if (b && b.hp) return json({ ok: true }); // honeypot: silently drop bots
    const name = String(b.name || '').trim().slice(0, 120);
    const pin = String(b.pin || '').trim();
    const subId = String(b.subscriptionID || b.subscription_id || '').trim();
    const email = String(b.email || '').trim().slice(0, 160) || null;
    const phone = String(b.phone || '').trim().slice(0, 40) || null;
    const category = String(b.category || '').trim().slice(0, 80) || null;
    const blurb = String(b.blurb || '').trim().slice(0, 300) || null;
    const website = String(b.website || '').trim().slice(0, 200) || null;
    if (!name) return json({ error: 'Business name is required.' }, 400);
    if (!/^\d{4,8}$/.test(pin)) return json({ error: 'Choose a 4–8 digit PIN.' }, 400);
    if (!subId) return json({ error: 'Please complete payment first.' }, 400);

    // 1) Verify the payment is real + active with PayPal (server-side).
    const pp = await verifyPayPalSubscription(env, subId);
    if (!pp.ok) return json({ error: 'payment_unverified', detail: pp.error, status: pp.status || null }, 402);
    const allowed = String(env.PAYPAL_PLAN_IDS || 'P-6YJ33771Y6287535FNJDLG4I').split(',').map((s) => s.trim());
    if (pp.plan_id && !allowed.includes(pp.plan_id)) return json({ error: 'plan_mismatch', plan: pp.plan_id }, 402);

    // 2) Idempotency — if this subscription already provisioned, return that account.
    const existing = await env.DB.prepare('SELECT slug FROM businesses WHERE subscription_id=?').bind(subId).first();
    if (existing) return json({ ok: true, slug: existing.slug, already: true });

    // 3) Identifiers + hashes (hub uses random salt; products use static-salt — same PIN works everywhere).
    const slug = await uniqueSlug(env, slugify(name));
    const salt = randomBytes(16).toString('hex');
    const hubHash = hashPin(pin, salt);
    const prodHash = hashPinStatic(pin);
    const modules = JSON.stringify({ herald: true, drawbridge: true });

    // 4) Create the hub account (public immediately).
    const insBiz = await env.DB.prepare(
      "INSERT INTO businesses (slug,name,town,pin_hash,salt,modules,category,blurb,phone,website,email,subscription_id,subscription_status,subscription_plan_id,subscription_checked_at,created_via,is_public)"
      + " VALUES (?,?,'titusville',?,?,?,?,?,?,?,?,?,'active',?,datetime('now'),'self-serve',1)"
    ).bind(slug, name, hubHash, salt, modules, category, blurb, phone, website, email, subId, pp.plan_id || null).run();
    // Audits the slug + name (both already public in the directory) and the PayPal
    // subscription id — that last one is the traceability this log exists for: it
    // ties an account that appeared out of nowhere back to a real payment. It is an
    // identifier, not a credential (it grants nothing on its own), and audit_log is
    // internal-only. The email, phone, and PIN supplied at signup stay out.
    await audit(env, request, {
      actor: 'public', action: 'business.create', entity_type: 'businesses', entity_id: insBiz.meta.last_row_id,
      summary: `self-serve signup created "${name}" (${slug}), public immediately — PayPal subscription ${subId}`,
    });

    // 5) Provision the product accounts (best-effort; a product hiccup shouldn't undo a paid signup).
    const warn = [];
    try {
      await env.HERALD_DB.prepare('INSERT OR IGNORE INTO businesses (name,slug,pin_hash) VALUES (?,?,?)').bind(name, slug, prodHash).run();
      await audit(env, request, { actor: 'system', action: 'business.provision', entity_type: 'herald.businesses', entity_id: slug, summary: `provisioned Herald account for ${slug}` });
    } catch (e) { warn.push('herald:' + String(e)); }
    try {
      await env.DRAWBRIDGE_DB.prepare('INSERT OR IGNORE INTO restaurants (slug,name,pin_hash,is_open) VALUES (?,?,?,1)').bind(slug, name, prodHash).run();
      await audit(env, request, { actor: 'system', action: 'business.provision', entity_type: 'drawbridge.restaurants', entity_id: slug, summary: `provisioned Drawbridge account for ${slug}` });
    } catch (e) { warn.push('drawbridge:' + String(e)); }

    // Welcome the paying owner with their Business ID. Previously they saw it once on the
    // success screen with no backup — close the tab and the login was gone. Never include
    // the PIN: they chose it, and emailing a credential is a bad habit to start.
    await sendEmail(env, email, `You're on the Square — welcome, ${name}`,
      `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.6;color:#241C12">
         <p>Welcome to Titusville Square, and thank you — you&rsquo;re a Founding Business.</p>
         <p><strong>Your Business ID is <code>${escHtml(slug)}</code></strong>. Keep this email; it&rsquo;s how you sign in.</p>
         <p>To post your specials, announcements and hours, sign in at
            <a href="https://titusvillesquare.com/manage">titusvillesquare.com/manage</a> using
            <strong>${escHtml(slug)}</strong> (or this email address) plus the PIN you chose at signup.</p>
         <p>Forgot the PIN? Just reply to this email and I&rsquo;ll sort it out.</p>
         <p>— Chrissy, Forever Still Studio</p>
       </div>`, 'hello');

    // Also send Chrissy the record, so an owner's login can always be recovered.
    await notify(env, `New Founding 50 signup: ${name}`,
      `${name}${category ? ' (' + category + ')' : ''}\n\n` +
      `Business ID (their login): ${slug}\n` +
      `Email: ${email || '-'}\nPhone: ${phone || '-'}\nWebsite: ${website || '-'}\n` +
      `PayPal subscription: ${subId}\n\n` +
      `They chose their own PIN at signup. They can sign in with this Business ID OR their\n` +
      `email at https://titusvillesquare.com/manage`);

    return json({ ok: true, slug, warn: warn.length ? warn : undefined });
  }

  // ---- public: free-listing submission (Part 2) — lands in a review queue, no auto-publish ----
  if (path === '/api/public/list-submit' && method === 'POST') {
    const b = await readBody(request);
    if (b && b.hp) return json({ ok: true }); // honeypot: silently accept + discard
    const ip = clientIp(request);
    if (!(await rateOk(env, ip, 'submission'))) return json({ error: 'rate_limited' }, 429);
    const name = String(b.name || '').trim().slice(0, 120);
    const category = String(b.category || '').trim().slice(0, 80);
    const email = String(b.email || '').trim().slice(0, 160);
    const description = String(b.description || '').trim().slice(0, 200);
    if (!name || !category || !description) return json({ error: 'Business name, category, and a one-line description are required.' }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'A valid email is required.' }, 400);
    if (!b.owner_ok) return json({ error: 'Please confirm you are the owner or authorized to submit this business.' }, 400);
    const address = String(b.address || '').trim().slice(0, 200) || null;
    const phone = String(b.phone || '').trim().slice(0, 40) || null;
    const website = String(b.website || '').trim().slice(0, 200) || null;
    const hours = String(b.hours || '').trim().slice(0, 400) || null;
    const want_audit = b.want_audit ? 1 : 0;
    const insSub = await env.DB.prepare(
      'INSERT INTO listing_submissions (name,category,address,phone,email,website,hours,description,want_audit,ip) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).bind(name, category, address, phone, email, website, hours, description, want_audit, ip).run();
    // The submitter's email/phone/address stay in listing_submissions where the
    // admin queue needs them; the audit row records only that a submission landed.
    await audit(env, request, {
      actor: 'public', action: 'listing.submit', entity_type: 'listing_submissions', entity_id: insSub.meta.last_row_id,
      summary: `listing submitted for "${name}" (${category}), pending review`,
    });
    await notify(env, `New Titusville Square listing: ${name}`,
      `${name} (${category})\nEmail: ${email}\nPhone: ${phone || '-'}\nAddress: ${address || '-'}\nWebsite: ${website || '-'}\nHours: ${hours || '-'}\nFree audit requested: ${want_audit ? 'YES' : 'no'}\n\n${description}\n\nApprove/reject: https://titusvillesquare.com/manage-events.html`);
    return json({ ok: true });
  }

  // ---- public: correction / removal request (Part 3) ----
  if (path === '/api/public/list-request' && method === 'POST') {
    const b = await readBody(request);
    if (b && b.hp) return json({ ok: true }); // honeypot
    const ip = clientIp(request);
    if (!(await rateOk(env, ip, 'request'))) return json({ error: 'rate_limited' }, 429);
    const business_name = String(b.business_name || '').trim().slice(0, 120);
    const requester = String(b.requester || '').trim().slice(0, 120);
    const email = String(b.email || '').trim().slice(0, 160);
    const kindRaw = String(b.kind || '').trim();
    const kind = kindRaw === 'remove' ? 'remove' : kindRaw === 'correct' ? 'correct' : '';
    if (!business_name || !requester) return json({ error: 'Business name and your name are required.' }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'A valid email is required.' }, 400);
    if (!kind) return json({ error: 'Please choose correct or remove.' }, 400);
    const relationship = String(b.relationship || '').trim().slice(0, 40) || null;
    const details = String(b.details || '').trim().slice(0, 800) || null;
    const insReq = await env.DB.prepare(
      'INSERT INTO listing_requests (business_name,requester,email,relationship,kind,details,ip) VALUES (?,?,?,?,?,?,?)'
    ).bind(business_name, requester, email, relationship, kind, details, ip).run();
    // Requester name/email and the free-text details are NOT audited — a removal
    // request can carry personal circumstances. Business name + kind is the trace.
    await audit(env, request, {
      actor: 'public', action: `listing.request_${kind}`, entity_type: 'listing_requests', entity_id: insReq.meta.last_row_id,
      summary: `${kind} request filed against listing "${business_name}"`,
    });
    const tag = kind === 'remove' ? '[REMOVAL]' : '[CORRECTION]';
    await notify(env, `${tag} ${business_name}`,
      `${tag}\nBusiness: ${business_name}\nFrom: ${requester} (${relationship || '-'})\nEmail: ${email}\n\n${details || '(no details given)'}\n\nTriage: https://titusvillesquare.com/manage-events.html`);
    return json({ ok: true });
  }

  // ---- public: start a listing claim (honeypot + rate-limited + email OTP) ----
  // A stranger claiming an existing business must NOT gain access just by knowing its
  // public email/slug — this only proves inbox control and lands the claim in an admin
  // review queue (/api/square/claims). Access is granted only on admin approval, via a
  // separate accept_code minted at that point (see /api/claim/:code/accept below).
  if (path === '/api/public/claim-start' && method === 'POST') {
    const b = await readBody(request);
    if (b && b.hp) return json({ ok: true }); // honeypot
    const ip = clientIp(request);
    if (!(await rateOk(env, ip, 'claim'))) return json({ error: 'rate_limited' }, 429);

    const slug = String(b.business_slug || b.slug || '').trim();
    const name = String(b.name || '').trim().slice(0, 120);
    const email = String(b.email || '').trim().slice(0, 160);
    const phone = String(b.phone || '').trim().slice(0, 40) || null;
    const role = ['Owner', 'Manager', 'Employee', 'Other'].includes(b.role) ? b.role : null;
    const message = String(b.message || '').trim().slice(0, 800) || null;

    if (!slug) return json({ error: 'A business is required.' }, 400);
    if (!name) return json({ error: 'Your name is required.' }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'A valid email is required.' }, 400);

    const biz = await env.DB.prepare('SELECT id, name, claim_status FROM businesses WHERE slug=?').bind(slug).first();
    if (!biz) return json({ error: 'business_not_found' }, 404);
    if (biz.claim_status === 'claimed') return json({ error: 'already_claimed' }, 409);

    const ABANDON_MS = 24 * 3600 * 1000;              // never got past email verification
    const PAYMENT_ABANDON_MS = 7 * 24 * 3600 * 1000;  // verified, then sat unpaid at the pay step
    const active = await env.DB.prepare(
      `SELECT id, claimant_email, status, created_at FROM listing_claims
       WHERE business_id=? AND status IN ('started','verification_required','payment_required','pending_review','approved')
       ORDER BY id DESC LIMIT 1`
    ).bind(biz.id).first();

    let claimId;
    if (active) {
      const sameEmail = active.claimant_email.toLowerCase() === email.toLowerCase();
      const preVerify = active.status === 'started' || active.status === 'verification_required';
      const awaitingPay = active.status === 'payment_required';
      const age = Date.now() - new Date(active.created_at).getTime();
      // "Abandoned" = a DIFFERENT person may take over the claim. Two windows: a claim that
      // never cleared email verification within 24h, or one that verified but has sat unpaid
      // at the payment step for over a week. Without the second window, a claim stuck at
      // payment locks the listing forever for everyone else (this stranded a real owner who
      // had simply mistyped their email on a second attempt). pending_review / approved are
      // NEVER auto-released — those are legitimately with the admin or the new owner.
      const abandoned = (preVerify && age > ABANDON_MS) || (awaitingPay && age > PAYMENT_ABANDON_MS);

      if (!sameEmail && !abandoned) {
        return json({ error: 'claim_in_progress' }, 409);
      }
      // Same person returning to their own already-verified, unpaid claim: hand them straight
      // back to the payment step — no new code, no re-verification.
      if (sameEmail && awaitingPay) {
        return json({ ok: true, claim_id: active.id, status: 'payment_required' });
      }
      // Same person on a claim already in review / approved: nothing to (re)send.
      if (sameEmail && !preVerify) {
        return json({ ok: true, claim_id: active.id, status: active.status });
      }
      // Otherwise: same person still pre-verification, OR a new person taking over an
      // abandoned claim. Reuse the row and (below) issue a fresh code. Clear the old
      // verification stamp so a taken-over claim can never read as already-verified.
      claimId = active.id;
      await env.DB.prepare(
        "UPDATE listing_claims SET claimant_name=?, claimant_email=?, claimant_phone=?, claimant_role=?, message=?, status='started', email_verified_at=NULL WHERE id=?"
      ).bind(name, email, phone, role, message, claimId).run();
    } else {
      const ins = await env.DB.prepare(
        'INSERT INTO listing_claims (business_id, claimant_name, claimant_email, claimant_phone, claimant_role, message, ip) VALUES (?,?,?,?,?,?,?)'
      ).bind(biz.id, name, email, phone, role, message, ip).run();
      claimId = ins.meta.last_row_id;
    }

    // Mint + send an OTP — best-effort; the claim row is saved and admin-visible
    // regardless of whether the email actually sends (RESEND_API_KEY unconfigured, etc.).
    const code = genOtpCode();
    const code_hash = hashOtpCode(code, env.SESSION_SECRET);
    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await env.DB.prepare(
      'INSERT INTO claim_otp_codes (claim_id, email, code_hash, expires_at) VALUES (?,?,?,?)'
    ).bind(claimId, email, code_hash, expires_at).run();

    const sendResult = await sendEmail(env, email, 'Your Titusville Square verification code',
      `<p>Your verification code for claiming <strong>${biz.name}</strong> on Titusville Square is:</p>
       <p style="font-size:28px;font-weight:bold;letter-spacing:6px;">${code}</p>
       <p>This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>`);

    await env.DB.prepare("UPDATE listing_claims SET status='verification_required' WHERE id=?").bind(claimId).run();
    await audit(env, request, {
      actor: 'public', action: 'claim.start', entity_type: 'listing_claims', entity_id: claimId,
      summary: `claim started on business "${biz.name}"`,
    });

    const resp = { ok: true, claim_id: claimId, sent: !!sendResult.sent };
    if (env.OTP_DEV_ECHO === '1') resp.dev_code = code; // dev-only escape hatch, mirrors Hearth's OTP_DEV_ECHO
    return json(resp);
  }

  // ---- public: verify a claim's emailed OTP code ----
  if (path === '/api/public/claim-verify' && method === 'POST') {
    const b = await readBody(request);
    const claimId = Number(b.claim_id);
    const code = String(b.code || '').trim();
    if (!claimId || !code) return json({ error: 'claim_id and code are required.' }, 400);

    const claim = await env.DB.prepare(
      'SELECT id, business_id, status, claimant_name, claimant_email FROM listing_claims WHERE id=?'
    ).bind(claimId).first();
    if (!claim) return json({ error: 'invalid_claim' }, 404);
    if (claim.status !== 'started' && claim.status !== 'verification_required') {
      return json({ error: 'not_awaiting_verification', status: claim.status }, 409);
    }

    const result = await verifyOtpCode(env, claimId, code);
    if (!result.ok) return json({ error: result.error }, result.error === 'too_many_attempts' ? 429 : 400);

    // Email verified — but the claim now waits on payment before it reaches Chrissy's
    // review queue. Admin review still happens AFTER payment; paying never approves.
    await env.DB.prepare("UPDATE listing_claims SET status='payment_required', email_verified_at=datetime('now') WHERE id=?").bind(claimId).run();
    const biz = await env.DB.prepare('SELECT id, name, claim_status FROM businesses WHERE id=?').bind(claim.business_id).first();
    if (biz && biz.claim_status === 'unclaimed') {
      await env.DB.prepare("UPDATE businesses SET claim_status='claim_pending' WHERE id=?").bind(biz.id).run();
    }
    await audit(env, request, {
      actor: 'public', action: 'claim.verify', entity_type: 'listing_claims', entity_id: claimId,
      summary: `email verified for claim on business "${biz ? biz.name : claim.business_id}"`,
    });
    // Alert on VERIFY, not just on payment. Someone who verifies and then stalls at the
    // pay step is a real person who tried and is worth following up with — and if the
    // notification only fired on payment, that person would be invisible. (Which is
    // exactly what happened to the first real claimant.)
    await notify(env, `Listing claim started (unpaid): ${biz ? biz.name : claim.business_id}`,
      `${claim.claimant_name || 'Someone'} verified their email for "${biz ? biz.name : claim.business_id}" `
      + `and is now at the payment step.\n\nClaimant: ${claim.claimant_email}\n\n`
      + `NOTHING IS OWED TO YOU YET and there is nothing to approve — this is only a heads-up that\n`
      + `someone is mid-claim. You'll get a second email if and when they subscribe.\n`
      + `If they go quiet, that's a good one to follow up on: https://titusvillesquare.com/manage-events.html`);

    return json({ ok: true, status: 'payment_required' });
  }

  // ---- public: claim payment — subscribe to Founding 50, then enter admin review ----
  // Verifies the subscription SERVER-SIDE (a spoofed client onApprove proves nothing) and
  // only moves the claim into the review queue. It deliberately grants NO listing access:
  // ownership still requires admin approval + the accept-code step.
  if (path === '/api/public/claim-pay' && method === 'POST') {
    const b = await readBody(request);
    const claimId = b && b.claim_id;
    const subId = String((b && (b.subscriptionID || b.subscription_id)) || '').trim();
    if (!claimId || !subId) return json({ error: 'claim_id and subscription are required.' }, 400);

    const claim = await env.DB.prepare('SELECT id, business_id, status, claimant_email FROM listing_claims WHERE id=?').bind(claimId).first();
    if (!claim) return json({ error: 'invalid_claim' }, 404);
    // Idempotent: a double-submit on an already-paid claim returns success, not an error.
    if (claim.status === 'pending_review') return json({ ok: true, status: 'pending_review', already: true });
    if (claim.status !== 'payment_required') {
      return json({ error: 'not_awaiting_payment', status: claim.status }, 409);
    }

    // One subscription can only ever back one business (mirrors /api/public/join).
    const taken = await env.DB.prepare('SELECT slug FROM businesses WHERE subscription_id=?').bind(subId).first();
    if (taken) return json({ error: 'subscription_already_used' }, 409);

    const pp = await verifyPayPalSubscription(env, subId);
    if (!pp.ok) return json({ error: 'payment_unverified', detail: pp.error, status: pp.status || null }, 402);
    const allowed = String(env.PAYPAL_PLAN_IDS || 'P-6YJ33771Y6287535FNJDLG4I').split(',').map((s) => s.trim());
    if (pp.plan_id && !allowed.includes(pp.plan_id)) return json({ error: 'plan_mismatch', plan: pp.plan_id }, 402);

    // Attach the subscription to the business now so the owner has paid features the moment
    // the claim is approved. Modules are NOT granted here — Chrissy enrolls those.
    await env.DB.prepare(
      "UPDATE businesses SET subscription_id=?, subscription_status='active', subscription_plan_id=?, subscription_checked_at=datetime('now') WHERE id=?"
    ).bind(subId, pp.plan_id || null, claim.business_id).run();
    await env.DB.prepare("UPDATE listing_claims SET status='pending_review' WHERE id=?").bind(claimId).run();

    const biz = await env.DB.prepare('SELECT id, name FROM businesses WHERE id=?').bind(claim.business_id).first();
    await audit(env, request, {
      actor: 'public', action: 'claim.paid', entity_type: 'listing_claims', entity_id: claimId,
      summary: `subscription ${subId} attached to "${biz ? biz.name : claim.business_id}"; claim awaiting ownership review`,
    });
    await notify(env, `New listing claim (PAID): ${biz ? biz.name : claim.business_id}`,
      `A claim on "${biz ? biz.name : claim.business_id}" is email-verified AND paid, awaiting your ownership review.\n\n`
      + `Claimant: ${claim.claimant_email}\nSubscription: ${subId}\n\nReview: https://titusvillesquare.com/manage-events.html`);

    return json({ ok: true, status: 'pending_review' });
  }

  // ---- owner: reactivate a lapsed subscription ----
  // Deliberately NOT a re-claim: ownership was already verified once and is never revoked by a
  // lapse, so this only flips paid features back on. No email loop, no admin review.
  if (path === '/api/owner/reactivate' && method === 'POST') {
    const s = sessionFrom(request, env);
    if (!s) return json({ error: 'unauthenticated' }, 401);
    const b = await readBody(request);
    const subId = String((b && (b.subscriptionID || b.subscription_id)) || '').trim();
    if (!subId) return json({ error: 'subscription is required.' }, 400);

    const biz = await env.DB.prepare('SELECT id, name, subscription_id, subscription_status FROM businesses WHERE slug=?').bind(s.slug).first();
    if (!biz) return json({ error: 'unauthenticated' }, 401);
    if (subscriptionActive(biz)) return json({ ok: true, already_active: true, subscription_status: biz.subscription_status });

    // Same uniqueness rule as join/claim-pay — except their OWN prior subscription id, which is
    // theirs to reuse if PayPal reactivated it rather than issuing a new one.
    const taken = await env.DB.prepare('SELECT id FROM businesses WHERE subscription_id=? AND id<>?').bind(subId, biz.id).first();
    if (taken) return json({ error: 'subscription_already_used' }, 409);

    const pp = await verifyPayPalSubscription(env, subId);
    if (!pp.ok) return json({ error: 'payment_unverified', detail: pp.error, status: pp.status || null }, 402);
    const allowedPlans = String(env.PAYPAL_PLAN_IDS || 'P-6YJ33771Y6287535FNJDLG4I').split(',').map((x) => x.trim());
    if (pp.plan_id && !allowedPlans.includes(pp.plan_id)) return json({ error: 'plan_mismatch', plan: pp.plan_id }, 402);

    await env.DB.prepare(
      "UPDATE businesses SET subscription_id=?, subscription_status='active', subscription_plan_id=?, subscription_checked_at=datetime('now') WHERE id=?"
    ).bind(subId, pp.plan_id || null, biz.id).run();
    await audit(env, request, {
      actor: 'owner', action: 'subscription.reactivate', entity_type: 'businesses', entity_id: biz.id,
      summary: `"${biz.name}" reactivated with subscription ${subId} (was ${biz.subscription_status || 'none'})`,
    });
    return json({ ok: true, subscription_status: 'active' });
  }

  // ---- square admin: manage events (PIN = the titusville-square account) ----
  if (path === '/api/square/events' && method === 'POST') {
    const b = await readBody(request);
    if (!(await squareOk(b && b.pin, env))) return json({ error: 'invalid_pin' }, 401);
    const act = b.action;
    if (act === 'list') {
      const rows = await env.DB.prepare(
        "SELECT id,title,starts_at,ends_at,location,description,is_published,is_kids,source FROM town_events WHERE town='titusville' ORDER BY is_published ASC, starts_at ASC"
      ).all();
      return json({ events: rows.results || [] });
    }
    if (act === 'publish' && b.id) {
      await env.DB.prepare('UPDATE town_events SET is_published=1 WHERE id=?').bind(b.id).run();
      await audit(env, request, {
        actor: 'admin', action: 'event.publish', entity_type: 'town_events', entity_id: b.id,
        summary: 'square admin published event',
      });
      return json({ ok: true });
    }
    if (act === 'kids' && b.id) {
      await env.DB.prepare('UPDATE town_events SET is_kids=? WHERE id=?').bind(b.kids ? 1 : 0, b.id).run();
      await audit(env, request, {
        actor: 'admin', action: 'event.flag_kids', entity_type: 'town_events', entity_id: b.id,
        summary: `square admin set is_kids=${b.kids ? 1 : 0}`,
      });
      return json({ ok: true });
    }
    if (act === 'delete' && b.id) {
      // Read the row BEFORE deleting. This is the whole point of the audit trail:
      // once the DELETE lands, entity_id alone is a dangling number and the record
      // of WHAT vanished is gone with it. Four events were deleted here with no
      // way to reconstruct them — the summary below is what was missing.
      const doomed = await env.DB.prepare('SELECT title, starts_at, is_published FROM town_events WHERE id=?').bind(b.id).first();
      await env.DB.prepare('DELETE FROM town_events WHERE id=?').bind(b.id).run();
      await audit(env, request, {
        actor: 'admin', action: 'event.delete', entity_type: 'town_events', entity_id: b.id,
        summary: doomed
          ? `square admin DELETED "${doomed.title}" (starts ${doomed.starts_at}, was ${doomed.is_published ? 'published' : 'a draft'})`
          : 'square admin issued delete for an event id that no longer existed',
      });
      return json({ ok: true });
    }
    return json({ error: 'bad_action' }, 400);
  }

  // ---- square admin: listing queues (PIN = the titusville-square account) ----
  if (path === '/api/square/listings' && method === 'POST') {
    const b = await readBody(request);
    if (!(await squareOk(b && b.pin, env))) return json({ error: 'invalid_pin' }, 401);
    const act = b.action;
    if (act === 'list') {
      const subs = await env.DB.prepare(
        "SELECT id,name,category,address,phone,email,website,hours,description,want_audit,status,created_at FROM listing_submissions ORDER BY (status='pending') DESC, created_at DESC LIMIT 200"
      ).all();
      const reqs = await env.DB.prepare(
        "SELECT id,business_name,requester,email,relationship,kind,details,status,created_at FROM listing_requests ORDER BY (status='open') DESC, created_at DESC LIMIT 200"
      ).all();
      return json({ submissions: subs.results || [], requests: reqs.results || [] });
    }
    // ---- directory taxonomy admin ----
    // The migration backfill only fills what it can defend; everything else lands
    // here. `category-review` = the queue of unclassified public listings;
    // `set-category` = the manual override (also how review-flagged calls get fixed).
    if (act === 'category-review') {
      const rows = await env.DB.prepare(
        `SELECT slug, name, category, primary_category, subcategory FROM businesses
         WHERE is_public=1 AND primary_category IS NULL ORDER BY name LIMIT 300`
      ).all();
      return json({ unclassified: rows.results || [] });
    }
    if (act === 'set-category' && b.slug) {
      const biz = await env.DB.prepare('SELECT id, name FROM businesses WHERE slug=?').bind(b.slug).first();
      if (!biz) return json({ error: 'not_found' }, 404);
      const v = validateTaxonomy(b.primary_category, b.subcategory, b.tags);
      if (v.error) return json({ error: v.error }, 400);
      await env.DB.prepare(
        'UPDATE businesses SET primary_category=?, subcategory=?' + (v.tags !== null ? ', tags=?' : '') + ' WHERE id=?'
      ).bind(...(v.tags !== null ? [v.primary, v.subcategory, JSON.stringify(v.tags), biz.id] : [v.primary, v.subcategory, biz.id])).run();
      await audit(env, request, {
        actor: 'admin', action: 'business.set_category', entity_type: 'businesses', entity_id: biz.id,
        summary: `admin classified "${biz.name}" as ${v.primary || '(none)'}${v.subcategory ? ' › ' + v.subcategory : ''}`,
      });
      return json({ ok: true });
    }

    // Approving must actually PUBLISH the listing into the `businesses` registry — that
    // registry (not this queue) is what the public directory reads. Un-approving pulls
    // back out only the exact row we published, tracked via published_slug.
    if (act === 'sub-status' && b.id && /^(pending|approved|rejected)$/.test(b.status || '')) {
      const sub = await env.DB.prepare('SELECT * FROM listing_submissions WHERE id=?').bind(b.id).first();
      if (!sub) return json({ error: 'not_found' }, 404);
      await env.DB.prepare('UPDATE listing_submissions SET status=? WHERE id=?').bind(b.status, b.id).run();
      const town = sub.town || 'titusville';
      let published = null, unpublished = null;

      if (b.status === 'approved') {
        let slug = sub.published_slug;
        if (!slug) {
          // Same name already in the registry (e.g. an existing panel)? adopt it, don't duplicate.
          const existing = await env.DB.prepare('SELECT slug FROM businesses WHERE town=? AND name=?').bind(town, sub.name).first();
          if (existing) {
            slug = existing.slug;
          } else {
            // New free listing lands as an unclaimed panel (modules {}) with a "Claim this listing" CTA.
            slug = await uniqueSlug(env, slugify(sub.name));
            const salt = randomBytes(16).toString('hex');
            const pin_hash = hashPin('4048', salt); // documented placeholder PIN for not-yet-claimed listings
            await env.DB.prepare(
              "INSERT INTO businesses (slug,name,town,pin_hash,salt,modules,is_public) VALUES (?,?,?,?,?,'{}',1)"
            ).bind(slug, sub.name, town, pin_hash, salt).run();
          }
          await env.DB.prepare('UPDATE listing_submissions SET published_slug=? WHERE id=?').bind(slug, b.id).run();
        }
        // ALWAYS publish + apply what they actually submitted (re-approving re-applies edits).
        // COALESCE so a blank submitted field never wipes good existing data. Auth/modules untouched.
        await env.DB.prepare(
          'UPDATE businesses SET is_public=1, category=COALESCE(?,category), blurb=COALESCE(?,blurb),' +
          ' address=COALESCE(?,address), phone=COALESCE(?,phone), website=COALESCE(?,website) WHERE slug=?'
        ).bind(sub.category, sub.description, sub.address, sub.phone, sub.website, slug).run();
        published = slug;
        // The listing form promises "we'll email you when you're live" — keep it.
        // Only on the first publish, so re-approving an edit doesn't re-spam them.
        if (!sub.notified_live_at && sub.email) {
          const r = await sendEmail(env, sub.email, `${sub.name} is live on Titusville Square`,
            `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.6;color:#241C12">
               <p>Good news — <strong>${escHtml(sub.name)}</strong> is now listed on Titusville Square.</p>
               <p><a href="https://titusvillesquare.com/?q=${encodeURIComponent(sub.name)}">See your listing &rarr;</a></p>
               <p>It&rsquo;s free and it stays free. If anything looks wrong, or you&rsquo;d like it taken down,
                  you can fix or remove it anytime at
                  <a href="https://titusvillesquare.com/my-listing">titusvillesquare.com/my-listing</a> — no questions asked.</p>
               <p>Thanks for being part of the Square.<br>— Chrissy, Forever Still Studio</p>
             </div>`, 'hello');
          if (r.sent) await env.DB.prepare("UPDATE listing_submissions SET notified_live_at=datetime('now') WHERE id=?").bind(b.id).run();
        }
      } else if (sub.published_slug) {
        // rejected / reset-to-pending: hide only the row we published.
        await env.DB.prepare('UPDATE businesses SET is_public=0 WHERE slug=?').bind(sub.published_slug).run();
        unpublished = sub.published_slug;
      }

      await audit(env, request, {
        actor: 'admin', action: 'listing.submission_status', entity_type: 'listing_submissions', entity_id: b.id,
        summary: `square admin set submission status to ${b.status}`
          + (published ? ` (published ${published})` : unpublished ? ` (unpublished ${unpublished})` : ''),
      });
      return json({ ok: true, published, unpublished });
    }
    if (act === 'req-status' && b.id && /^(open|resolved)$/.test(b.status || '')) {
      await env.DB.prepare('UPDATE listing_requests SET status=? WHERE id=?').bind(b.status, b.id).run();
      await audit(env, request, {
        actor: 'admin', action: 'listing.request_status', entity_type: 'listing_requests', entity_id: b.id,
        summary: `square admin set request status to ${b.status}`,
      });
      return json({ ok: true });
    }
    return json({ error: 'bad_action' }, 400);
  }

  // ---- square admin: manage listing claims (PIN = the titusville-square account) ----
  if (path === '/api/square/claims' && method === 'POST') {
    const b = await readBody(request);
    if (!(await squareOk(b && b.pin, env))) return json({ error: 'invalid_pin' }, 401);
    const act = b.action;

    if (act === 'list') {
      const claims = await env.DB.prepare(
        `SELECT lc.id, lc.business_id, biz.name as business_name, biz.slug as business_slug,
                lc.claimant_name, lc.claimant_email, lc.claimant_phone, lc.claimant_role, lc.message,
                lc.status, lc.email_verified_at, lc.reviewed_at, lc.reject_reason, lc.created_at,
                biz.subscription_status, biz.subscription_id, biz.subscription_checked_at
         FROM listing_claims lc JOIN businesses biz ON biz.id = lc.business_id
         ORDER BY (lc.status='pending_review') DESC, lc.created_at DESC LIMIT 200`
      ).all();
      return json({ claims: claims.results || [] });
    }

    if (act === 'approve' && b.id) {
      const claim = await env.DB.prepare(
        'SELECT id, business_id, status, claimant_name, claimant_email FROM listing_claims WHERE id=?'
      ).bind(b.id).first();
      if (!claim) return json({ error: 'not_found' }, 404);
      if (claim.status !== 'pending_review') return json({ error: 'not_pending_review' }, 409);

      // Defence in depth. `pending_review` is only reachable through claim-pay today, so this
      // is a second lock on the same door — but it guards money, and one lock is one bug away
      // from being none. Check the business's own subscription independently.
      //
      // `grandfathered` deliberately does NOT qualify. It was a migration courtesy for the ~225
      // listings that already existed, not a free pass for a new owner taking one over: without
      // this, claiming any pre-existing listing would inherit paid features permanently, free.
      const bizSub = await env.DB.prepare('SELECT subscription_status FROM businesses WHERE id=?')
        .bind(claim.business_id).first();
      const paidUp = bizSub && (bizSub.subscription_status === 'active' || bizSub.subscription_status === 'comped');
      if (!paidUp) {
        return json({
          error: 'subscription_required',
          subscription_status: bizSub ? bizSub.subscription_status : null,
        }, 402);
      }

      const accept_code = randomBytes(16).toString('hex');
      const expires_at = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
      await env.DB.prepare(
        "UPDATE listing_claims SET status='approved', accept_code=?, accept_code_expires_at=?, reviewed_by='admin', reviewed_at=datetime('now') WHERE id=?"
      ).bind(accept_code, expires_at, claim.id).run();

      const biz = await env.DB.prepare('SELECT id, name FROM businesses WHERE id=?').bind(claim.business_id).first();
      await sendEmail(env, claim.claimant_email, `You're approved — claim your ${biz ? biz.name : 'business'} listing`,
        `<p>Hi ${claim.claimant_name},</p>
         <p>Your claim on <strong>${biz ? biz.name : 'your business'}</strong> has been approved. Click below to
         choose your PIN and access your dashboard:</p>
         <p><a href="https://gettownsquare.app/?claim=${accept_code}">Claim your listing</a></p>
         <p>This link expires in 7 days.</p>`);

      await audit(env, request, {
        actor: 'admin', action: 'claim.approve', entity_type: 'listing_claims', entity_id: claim.id,
        summary: `square admin approved claim on business ${claim.business_id}`,
      });
      return json({ ok: true });
    }

    if (act === 'reject' && b.id) {
      const claim = await env.DB.prepare('SELECT id, business_id, status FROM listing_claims WHERE id=?').bind(b.id).first();
      if (!claim) return json({ error: 'not_found' }, 404);
      const reason = String(b.reason || '').trim().slice(0, 300) || null;
      await env.DB.prepare(
        "UPDATE listing_claims SET status='rejected', reject_reason=?, reviewed_by='admin', reviewed_at=datetime('now') WHERE id=?"
      ).bind(reason, claim.id).run();
      // Free the business back up for a future claim, unless something else already
      // claimed it in the meantime (shouldn't happen given the claim_in_progress guard
      // at claim-start, but don't clobber a real claimed state if it somehow did).
      const biz = await env.DB.prepare('SELECT id, claim_status FROM businesses WHERE id=?').bind(claim.business_id).first();
      if (biz && biz.claim_status !== 'claimed') {
        await env.DB.prepare("UPDATE businesses SET claim_status='unclaimed' WHERE id=?").bind(biz.id).run();
      }
      await audit(env, request, {
        actor: 'admin', action: 'claim.reject', entity_type: 'listing_claims', entity_id: claim.id,
        summary: `square admin rejected claim on business ${claim.business_id}`,
      });
      return json({ ok: true });
    }

    if (act === 'revoke' && b.id) {
      const claim = await env.DB.prepare(
        'SELECT id, business_id, status, accepted_user_id FROM listing_claims WHERE id=?'
      ).bind(b.id).first();
      if (!claim) return json({ error: 'not_found' }, 404);
      await env.DB.prepare(
        "UPDATE listing_claims SET status='revoked', accept_code=NULL, reviewed_by='admin', reviewed_at=datetime('now') WHERE id=?"
      ).bind(claim.id).run();
      await env.DB.prepare("UPDATE businesses SET claim_status='unclaimed' WHERE id=?").bind(claim.business_id).run();
      // If the claim was already redeemed, deactivate the access it granted too —
      // revoking a claim should actually revoke access, not just the paperwork. Also
      // rotate businesses.pin_hash/salt to an unknown value: the legacy-fallback login
      // path checks that hash directly (before ever looking at users.is_active), so
      // leaving the redeemed PIN in place would let it back in via that path.
      if (claim.accepted_user_id) {
        await env.DB.prepare('UPDATE users SET is_active=0 WHERE id=?').bind(claim.accepted_user_id).run();
        const revokedSalt = randomBytes(16).toString('hex');
        const revokedHash = hashPin(randomBytes(32).toString('hex'), revokedSalt);
        await env.DB.prepare('UPDATE businesses SET pin_hash=?, salt=? WHERE id=?')
          .bind(revokedHash, revokedSalt, claim.business_id).run();
      }
      await audit(env, request, {
        actor: 'admin', action: 'claim.revoke', entity_type: 'listing_claims', entity_id: claim.id,
        summary: `square admin revoked claim on business ${claim.business_id}${claim.accepted_user_id ? ' (deactivated redeemed user)' : ''}`,
      });
      return json({ ok: true });
    }

    if (act === 'reset' && b.id) {
      // Guarded: reset used to be a blind UPDATE, so it could resurrect a `completed`
      // claim (one whose owner has already accepted and holds a PIN) back into the
      // review queue — now carrying a stale subscription too. Only reopen dead claims.
      const cur = await env.DB.prepare('SELECT status FROM listing_claims WHERE id=?').bind(b.id).first();
      if (!cur) return json({ error: 'not_found' }, 404);
      if (cur.status !== 'rejected' && cur.status !== 'revoked') {
        return json({ error: 'not_resettable', status: cur.status }, 409);
      }
      await env.DB.prepare(
        "UPDATE listing_claims SET status='pending_review', reviewed_by=NULL, reviewed_at=NULL, reject_reason=NULL WHERE id=?"
      ).bind(b.id).run();
      await audit(env, request, {
        actor: 'admin', action: 'claim.reset', entity_type: 'listing_claims', entity_id: b.id,
        summary: 'square admin reset claim to pending_review',
      });
      return json({ ok: true });
    }

    return json({ error: 'bad_action' }, 400);
  }

  // Enriched town feed for the community app: registry directory + live signals
  // (Drawbridge open/specials, Herald announcements) + events, in one cached call.
  // Each product call is best-effort — a product outage just drops that signal.
  if (path === '/api/public/town' && method === 'GET') {
    const town = url.searchParams.get('town') || 'titusville';
    const rows = await env.DB.prepare(
      `SELECT slug,name,category,blurb,website,logo,primary_color,forge_url,product_slugs,modules,
              subscription_status,
              primary_category,subcategory,tags,
              full_description,secondary_categories,address,service_area,phone,email,
              public_contact_preference,social_links,price_range,accessibility_info,parking_info,
              family_friendly,pet_friendly,appointment_required,service_notes
       FROM businesses WHERE town=? AND is_public=1 ORDER BY name`
    ).bind(town).all();

    const businesses = await Promise.all((rows.results || []).map((b) => buildPublicProjection(b)));

    const ev = await env.DB.prepare(
      `SELECT id,title,starts_at,ends_at,location,description,is_kids,is_canceled,audience,age_range,
              category,cost,registration_required,registration_link,contact_info,image,accessibility_notes
       FROM town_events WHERE town=? AND is_published=1 AND starts_at >= datetime('now','-1 day') AND starts_at < datetime('now',?) ORDER BY starts_at LIMIT ?`
    ).bind(town, EVENT_WINDOW, EVENT_CAP).all();

    return json({ town, businesses, events: ev.results || [] }, 200, { 'Cache-Control': 'public, max-age=120' });
  }

  // ---- team: list active members (MANAGER+) ----
  if (path === '/api/team' && method === 'GET') {
    const ctx = await requireRole(request, env, 'MANAGER');
    if (!ctx) return json({ error: 'forbidden' }, 403);
    const rows = await env.DB.prepare(
      "SELECT id, name, role, last_login_at, created_at FROM users WHERE business_id=? AND is_active=1 ORDER BY (role='OWNER') DESC, created_at ASC"
    ).bind(ctx.businessId).all();
    return json({ members: rows.results || [] });
  }

  // ---- team: invite a teammate (OWNER only) ----
  if (path === '/api/team/invite' && method === 'POST') {
    const ctx = await requireRole(request, env, 'OWNER');
    if (!ctx) return json({ error: 'forbidden' }, 403);
    const b = await readBody(request);
    const name = String(b.name || '').trim().slice(0, 80) || null;
    // Invites can only grant MANAGER/STAFF — a second OWNER is a deliberate role
    // change made later via PATCH, not something an invite link should mint.
    const role = ['MANAGER', 'STAFF'].includes(b.role) ? b.role : 'STAFF';
    const invite_code = randomBytes(12).toString('hex');
    const expires_at = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    await env.DB.prepare(
      'INSERT INTO business_invitations (business_id, invite_code, name, role, invited_by, expires_at) VALUES (?,?,?,?,?,?)'
    ).bind(ctx.businessId, invite_code, name, role, ctx.userId, expires_at).run();
    await logActivity(env, ctx.businessId, 'team_invited', `${name || 'teammate'} (${role})`);
    // invite_code is a bearer credential — anyone holding it can join the team and
    // set a PIN. It is deliberately absent from the audit row.
    await audit(env, request, {
      actor: ctx.slug, action: 'team.invite', entity_type: 'business_invitations', entity_id: ctx.businessId,
      summary: `user #${ctx.userId} (OWNER) invited ${name || 'a teammate'} as ${role}`,
    });
    return json({ ok: true, invite_code, expires_at });
  }

  // ---- team: resolve an invite for the accept screen (public — no session yet) ----
  if (path.match(/^\/api\/team\/invite\/[^/]+$/) && method === 'GET') {
    const code = path.split('/').pop();
    const inv = await env.DB.prepare(
      `SELECT bi.role, bi.status, bi.expires_at, b.name as business_name
       FROM business_invitations bi JOIN businesses b ON b.id = bi.business_id
       WHERE bi.invite_code=?`
    ).bind(code).first();
    if (!inv || inv.status !== 'pending' || new Date(inv.expires_at) < new Date()) {
      return json({ error: 'invalid_or_expired_invite' }, 404);
    }
    return json({ business_name: inv.business_name, role: inv.role });
  }

  // ---- team: accept an invite, choose your own PIN (public — this IS the login) ----
  if (path.match(/^\/api\/team\/invite\/[^/]+\/accept$/) && method === 'POST') {
    const code = path.split('/')[4]; // ['', 'api', 'team', 'invite', ':code', 'accept']
    const b = await readBody(request);
    const inv = await env.DB.prepare('SELECT * FROM business_invitations WHERE invite_code=?').bind(code).first();
    if (!inv || inv.status !== 'pending' || new Date(inv.expires_at) < new Date()) {
      return json({ error: 'invalid_or_expired_invite' }, 404);
    }
    const name = String(b.name || '').trim().slice(0, 80) || inv.name || 'Teammate';
    const pin = String(b.pin || '').trim();
    if (!/^\d{4,8}$/.test(pin)) return json({ error: 'Choose a 4-8 digit PIN.' }, 400);

    // PIN must be unique within this business — two teammates with the identical
    // PIN would be indistinguishable at login (login matches by hash, first wins).
    const active = await env.DB.prepare('SELECT pin_hash, salt FROM users WHERE business_id=? AND is_active=1').bind(inv.business_id).all();
    for (const m of active.results || []) {
      if (verifyPin(pin, m.salt, m.pin_hash)) return json({ error: 'That PIN is already in use on this team. Choose a different one.' }, 400);
    }

    const salt = randomBytes(16).toString('hex');
    const pin_hash = hashPin(pin, salt);
    const ins = await env.DB.prepare(
      'INSERT INTO users (business_id, name, pin_hash, salt, role) VALUES (?,?,?,?,?)'
    ).bind(inv.business_id, name, pin_hash, salt, inv.role).run();
    const newUserId = ins.meta.last_row_id;
    await env.DB.prepare("UPDATE business_invitations SET status='accepted', accepted_user_id=? WHERE id=?").bind(newUserId, inv.id).run();
    await logActivity(env, inv.business_id, 'team_invited', `${name} accepted (${inv.role})`);
    const acceptBiz = await env.DB.prepare('SELECT slug FROM businesses WHERE id=?').bind(inv.business_id).first();
    // This route SETS a PIN. The PIN, its hash, and its salt are never audited —
    // only the fact that a new credentialed user now exists on this team.
    await audit(env, request, {
      actor: (acceptBiz && acceptBiz.slug) || 'public', action: 'team.invite_accept',
      entity_type: 'users', entity_id: newUserId,
      summary: `invite accepted — new ${inv.role} user #${newUserId} created with their own PIN`,
    });

    const biz = await env.DB.prepare('SELECT slug, name, town, modules FROM businesses WHERE id=?').bind(inv.business_id).first();
    const session = signClassic({ slug: biz.slug, exp: Date.now() + TTL_MS, uid: newUserId, role: inv.role }, env.SESSION_SECRET);
    return json(
      { slug: biz.slug, name: biz.name, town: biz.town, modules: parse(biz.modules, {}), role: inv.role, userId: newUserId, token: session },
      200,
      { 'Set-Cookie': cookie('ts_session', session, TTL_MS / 1000) }
    );
  }

  // ---- team: change role / revoke a member (OWNER only) ----
  if (path.match(/^\/api\/team\/members\/\d+$/) && (method === 'PATCH' || method === 'DELETE')) {
    const ctx = await requireRole(request, env, 'OWNER');
    if (!ctx) return json({ error: 'forbidden' }, 403);
    const targetId = Number(path.split('/').pop());
    const target = await env.DB.prepare('SELECT id, business_id, role, is_active FROM users WHERE id=?').bind(targetId).first();
    if (!target || target.business_id !== ctx.businessId) return json({ error: 'not_found' }, 404);

    const body = method === 'PATCH' ? await readBody(request) : null;
    // Only block when the mutation would actually REMOVE owner status — not on
    // an unrelated field change to an owner's own row.
    const removingOwnerStatus = method === 'DELETE' ||
      (body && ((body.role !== undefined && body.role !== 'OWNER') || (body.is_active !== undefined && !body.is_active)));
    if (target.role === 'OWNER' && target.is_active && removingOwnerStatus) {
      const owners = await env.DB.prepare("SELECT COUNT(*) as c FROM users WHERE business_id=? AND role='OWNER' AND is_active=1").bind(ctx.businessId).first();
      if (owners.c <= 1) return json({ error: 'cannot_remove_last_owner' }, 400);
    }

    if (method === 'DELETE') {
      // Soft-revoke only — never hard-delete, so activity_log referencing this user stays meaningful.
      await env.DB.prepare('UPDATE users SET is_active=0 WHERE id=?').bind(targetId).run();
      await logActivity(env, ctx.businessId, 'team_removed', targetId);
      await audit(env, request, {
        actor: ctx.slug, action: 'team.revoke', entity_type: 'users', entity_id: targetId,
        summary: `user #${ctx.userId} (OWNER) revoked ${target.role} user #${targetId}`,
      });
      return json({ ok: true });
    }

    if (body.role !== undefined) {
      if (!['OWNER', 'MANAGER', 'STAFF'].includes(body.role)) return json({ error: 'bad_role' }, 400);
      await env.DB.prepare('UPDATE users SET role=? WHERE id=?').bind(body.role, targetId).run();
      await logActivity(env, ctx.businessId, 'team_role_changed', `${targetId} -> ${body.role}`);
      await audit(env, request, {
        actor: ctx.slug, action: 'team.role_change', entity_type: 'users', entity_id: targetId,
        summary: `user #${ctx.userId} (OWNER) changed user #${targetId} from ${target.role} to ${body.role}`,
      });
    }
    if (body.is_active !== undefined) {
      await env.DB.prepare('UPDATE users SET is_active=? WHERE id=?').bind(body.is_active ? 1 : 0, targetId).run();
      if (!body.is_active) await logActivity(env, ctx.businessId, 'team_removed', targetId);
      // Audited in BOTH directions. activity_log only records deactivation, so a
      // revoked teammate being quietly REACTIVATED leaves no trace there at all.
      await audit(env, request, {
        actor: ctx.slug, action: body.is_active ? 'team.reactivate' : 'team.revoke',
        entity_type: 'users', entity_id: targetId,
        summary: `user #${ctx.userId} (OWNER) set user #${targetId} is_active=${body.is_active ? 1 : 0}`,
      });
    }
    return json({ ok: true });
  }

  // ---- business profile: read (STAFF+) ----
  if (path === '/api/business/profile' && method === 'GET') {
    const ctx = await requireRole(request, env, 'STAFF');
    if (!ctx) return json({ error: 'forbidden' }, 403);
    const biz = await env.DB.prepare(
      `SELECT slug, name, town, category, blurb, primary_category, subcategory, tags, full_description, secondary_categories, address,
              service_area, phone, email, website, public_contact_preference, social_links,
              price_range, accessibility_info, parking_info, family_friendly, pet_friendly,
              appointment_required, service_notes, logo, primary_color, is_public
       FROM businesses WHERE id=?`
    ).bind(ctx.businessId).first();
    if (!biz) return json({ error: 'not_found' }, 404);
    return json({
      ...biz,
      secondary_categories: parse(biz.secondary_categories, []),
      social_links: parse(biz.social_links, {}),
      tags: parse(biz.tags, []),
    });
  }

  // ---- business profile: update (MANAGER+) ----
  if (path === '/api/business/profile' && method === 'PATCH') {
    const ctx = await requireRole(request, env, 'MANAGER');
    if (!ctx) return json({ error: 'forbidden' }, 403);
    const b = await readBody(request);
    // Allow-listed scalar columns only — never accept arbitrary column names from the client.
    const TEXT_MAX = {
      name: 120, category: 80, blurb: 300, full_description: 4000, address: 200, service_area: 200,
      phone: 40, email: 160, website: 200, public_contact_preference: 20, price_range: 4,
      accessibility_info: 600, parking_info: 600, service_notes: 600, logo: 500, primary_color: 20,
    };
    const BOOL_COLS = new Set(['family_friendly', 'pet_friendly', 'appointment_required', 'is_public']);
    const sets = [], vals = [];
    for (const key of Object.keys(TEXT_MAX)) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) continue;
      sets.push(`${key}=?`);
      vals.push(b[key] == null ? null : String(b[key]).trim().slice(0, TEXT_MAX[key]));
    }
    for (const key of BOOL_COLS) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) continue;
      sets.push(`${key}=?`);
      vals.push(b[key] === null || b[key] === undefined ? null : (b[key] ? 1 : 0));
    }
    if (Object.prototype.hasOwnProperty.call(b, 'secondary_categories')) {
      sets.push('secondary_categories=?');
      vals.push(JSON.stringify(Array.isArray(b.secondary_categories) ? b.secondary_categories.slice(0, 10) : []));
    }
    if (Object.prototype.hasOwnProperty.call(b, 'social_links')) {
      const sl = b.social_links && typeof b.social_links === 'object' ? b.social_links : {};
      sets.push('social_links=?');
      vals.push(JSON.stringify({ facebook: sl.facebook || null, instagram: sl.instagram || null, other: sl.other || null }));
    }
    // Directory taxonomy: validated as a UNIT, merged with current values first —
    // a subcategory arriving without its primary must be checked against the primary
    // the business already has, and clearing the primary must clear the sub with it.
    const hasTax = ['primary_category', 'subcategory', 'tags'].some((k) => Object.prototype.hasOwnProperty.call(b, k));
    if (hasTax) {
      const cur = await env.DB.prepare('SELECT primary_category, subcategory, tags FROM businesses WHERE id=?')
        .bind(ctx.businessId).first();
      const merged = validateTaxonomy(
        Object.prototype.hasOwnProperty.call(b, 'primary_category') ? b.primary_category : cur.primary_category,
        Object.prototype.hasOwnProperty.call(b, 'subcategory') ? b.subcategory
          // changing primary without naming a sub drops the old sub rather than
          // carrying a sub that belongs to a different category
          : (Object.prototype.hasOwnProperty.call(b, 'primary_category') ? null : cur.subcategory),
        Object.prototype.hasOwnProperty.call(b, 'tags') ? b.tags : undefined
      );
      if (merged.error) return json({ error: merged.error }, 400);
      sets.push('primary_category=?', 'subcategory=?');
      vals.push(merged.primary, merged.subcategory);
      if (merged.tags !== null) { sets.push('tags=?'); vals.push(JSON.stringify(merged.tags)); }
    }
    if (!sets.length) return json({ error: 'no_fields' }, 400);
    vals.push(ctx.businessId);
    await env.DB.prepare(`UPDATE businesses SET ${sets.join(', ')} WHERE id=?`).bind(...vals).run();
    await logActivity(env, ctx.businessId, 'profile_updated', Object.keys(b).join(','));
    // Field NAMES only, never the submitted values: this payload can carry the
    // business's phone and email, and `is_public` flips the whole listing's
    // visibility — worth knowing it changed and who changed it.
    await audit(env, request, {
      actor: ctx.slug, action: 'business.profile_update', entity_type: 'businesses', entity_id: ctx.businessId,
      summary: `user #${ctx.userId} (${ctx.role}) updated: ${sets.map((s) => s.replace('=?', '')).join(', ')}`,
    });
    return json({ ok: true });
  }

  // ---- business events: list mine, drafts + published (STAFF+) ----
  if (path === '/api/business/events' && method === 'GET') {
    const ctx = await requireRole(request, env, 'STAFF');
    if (!ctx) return json({ error: 'forbidden' }, 403);
    const rows = await env.DB.prepare(
      `SELECT id, title, starts_at, ends_at, location, description, is_published, is_kids, audience,
              age_range, category, cost, registration_required, registration_link, contact_info, image,
              accessibility_notes, is_canceled, moderation_required, created_at
       FROM town_events WHERE business_id=? ORDER BY starts_at DESC`
    ).bind(ctx.businessId).all();
    return json({ events: rows.results || [] });
  }

  // ---- business events: create (MANAGER+) ----
  if (path === '/api/business/events' && method === 'POST') {
    const ctx = await requireRole(request, env, 'MANAGER');
    if (!ctx) return json({ error: 'forbidden' }, 403);
    const b = await readBody(request);
    const title = String(b.title || '').trim().slice(0, 120);
    const starts_at = String(b.starts_at || '').trim().slice(0, 16);
    if (!title || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(starts_at)) {
      return json({ error: 'A title and a valid date/time are required.' }, 400);
    }
    const biz = await env.DB.prepare('SELECT town, modules FROM businesses WHERE id=?').bind(ctx.businessId).first();
    // Per-business flag, not hardcoded — settable via the existing `modules` JSON
    // column (e.g. {"moderate_events": true}) rather than a dedicated setting,
    // since no admin UI for it exists yet in Phase 1.
    const moderationRequired = !!parse(biz.modules, {}).moderate_events;
    const ends_at = String(b.ends_at || '').trim().slice(0, 16) || null;
    const location = String(b.location || '').trim().slice(0, 120) || null;
    const description = String(b.description || '').trim().slice(0, 600) || null;
    const is_kids = b.is_kids ? 1 : 0;
    const audience = String(b.audience || '').trim().slice(0, 120) || null;
    const age_range = String(b.age_range || '').trim().slice(0, 40) || null;
    const category = String(b.category || '').trim().slice(0, 60) || null;
    const cost = String(b.cost || '').trim().slice(0, 60) || null;
    const registration_required = b.registration_required ? 1 : 0;
    const registration_link = String(b.registration_link || '').trim().slice(0, 300) || null;
    const contact_info = String(b.contact_info || '').trim().slice(0, 200) || null;
    const image = String(b.image || '').trim().slice(0, 500) || null;
    const accessibility_notes = String(b.accessibility_notes || '').trim().slice(0, 300) || null;

    const ins = await env.DB.prepare(
      `INSERT INTO town_events (business_id, town, title, starts_at, ends_at, location, description,
         is_published, is_kids, source, audience, age_range, category, cost, registration_required,
         registration_link, contact_info, image, accessibility_notes, moderation_required)
       VALUES (?,?,?,?,?,?,?, 0, ?, 'owner', ?,?,?,?,?,?,?,?,?, ?)`
    ).bind(
      ctx.businessId, biz.town, title, starts_at, ends_at, location, description, is_kids,
      audience, age_range, category, cost, registration_required, registration_link, contact_info,
      image, accessibility_notes, moderationRequired ? 1 : 0
    ).run();
    await logActivity(env, ctx.businessId, 'event_created', title);
    await audit(env, request, {
      actor: ctx.slug, action: 'event.create', entity_type: 'town_events', entity_id: ins.meta.last_row_id,
      summary: `user #${ctx.userId} (${ctx.role}) created draft "${title}" (starts ${starts_at})`,
    });
    return json({ ok: true, id: ins.meta.last_row_id });
  }

  // ---- business events: edit mine (MANAGER+) ----
  if (path.match(/^\/api\/business\/events\/\d+$/) && method === 'PATCH') {
    const ctx = await requireRole(request, env, 'MANAGER');
    if (!ctx) return json({ error: 'forbidden' }, 403);
    const id = Number(path.split('/').pop());
    const ev = await env.DB.prepare('SELECT id, business_id FROM town_events WHERE id=?').bind(id).first();
    if (!ev || ev.business_id !== ctx.businessId) return json({ error: 'not_found' }, 404); // cross-business isolation
    const b = await readBody(request);
    const ALLOWED = ['title', 'starts_at', 'ends_at', 'location', 'description', 'is_kids', 'audience',
      'age_range', 'category', 'cost', 'registration_required', 'registration_link', 'contact_info',
      'image', 'accessibility_notes'];
    const BOOL_COLS = new Set(['is_kids', 'registration_required']);
    const sets = [], vals = [];
    for (const key of ALLOWED) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) continue;
      sets.push(`${key}=?`);
      vals.push(BOOL_COLS.has(key) ? (b[key] ? 1 : 0) : b[key]);
    }
    if (!sets.length) return json({ error: 'no_fields' }, 400);
    vals.push(id);
    await env.DB.prepare(`UPDATE town_events SET ${sets.join(', ')} WHERE id=?`).bind(...vals).run();
    // This route had NO logging of any kind before the audit trail: an owner could
    // silently rewrite a published event's title, date, or location and nothing
    // recorded it. Field names only — event copy is free text.
    await audit(env, request, {
      actor: ctx.slug, action: 'event.update', entity_type: 'town_events', entity_id: id,
      summary: `user #${ctx.userId} (${ctx.role}) edited fields: ${sets.map((s) => s.replace('=?', '')).join(', ')}`,
    });
    return json({ ok: true });
  }

  // ---- business events: delete a draft (MANAGER+; published events must be canceled, not deleted) ----
  if (path.match(/^\/api\/business\/events\/\d+$/) && method === 'DELETE') {
    const ctx = await requireRole(request, env, 'MANAGER');
    if (!ctx) return json({ error: 'forbidden' }, 403);
    const id = Number(path.split('/').pop());
    const ev = await env.DB.prepare('SELECT id, business_id, is_published FROM town_events WHERE id=?').bind(id).first();
    if (!ev || ev.business_id !== ctx.businessId) return json({ error: 'not_found' }, 404);
    if (ev.is_published) return json({ error: 'cannot_delete_published', detail: 'Cancel a published event instead of deleting it.' }, 400);
    // Same reason as the square-admin delete: capture the title before the row goes.
    const doomed = await env.DB.prepare('SELECT title, starts_at FROM town_events WHERE id=?').bind(id).first();
    await env.DB.prepare('DELETE FROM town_events WHERE id=?').bind(id).run();
    await logActivity(env, ctx.businessId, 'event_deleted', id);
    await audit(env, request, {
      actor: ctx.slug, action: 'event.delete', entity_type: 'town_events', entity_id: id,
      summary: `user #${ctx.userId} (${ctx.role}) deleted draft "${doomed ? doomed.title : '(unknown)'}"`,
    });
    return json({ ok: true });
  }

  // ---- business events: self-serve publish (MANAGER+, unless moderation is required) ----
  if (path.match(/^\/api\/business\/events\/\d+\/publish$/) && method === 'POST') {
    const ctx = await requireRole(request, env, 'MANAGER');
    if (!ctx) return json({ error: 'forbidden' }, 403);
    const id = Number(path.split('/')[4]);
    const ev = await env.DB.prepare('SELECT id, business_id, moderation_required FROM town_events WHERE id=?').bind(id).first();
    if (!ev || ev.business_id !== ctx.businessId) return json({ error: 'not_found' }, 404);
    if (ev.moderation_required) {
      return json({ error: 'moderation_required', detail: 'This event needs Titusville Square staff approval before it can go live.' }, 403);
    }
    await env.DB.prepare('UPDATE town_events SET is_published=1 WHERE id=?').bind(id).run();
    await logActivity(env, ctx.businessId, 'event_published', id);
    await audit(env, request, {
      actor: ctx.slug, action: 'event.publish', entity_type: 'town_events', entity_id: id,
      summary: `user #${ctx.userId} (${ctx.role}) published event — now live on the Square`,
    });
    return json({ ok: true });
  }

  // ---- business events: cancel (stays visible, badged — never silently disappears) ----
  if (path.match(/^\/api\/business\/events\/\d+\/cancel$/) && method === 'POST') {
    const ctx = await requireRole(request, env, 'MANAGER');
    if (!ctx) return json({ error: 'forbidden' }, 403);
    const id = Number(path.split('/')[4]);
    const ev = await env.DB.prepare('SELECT id, business_id FROM town_events WHERE id=?').bind(id).first();
    if (!ev || ev.business_id !== ctx.businessId) return json({ error: 'not_found' }, 404);
    await env.DB.prepare('UPDATE town_events SET is_canceled=1 WHERE id=?').bind(id).run();
    await logActivity(env, ctx.businessId, 'event_canceled', id);
    await audit(env, request, {
      actor: ctx.slug, action: 'event.cancel', entity_type: 'town_events', entity_id: id,
      summary: `user #${ctx.userId} (${ctx.role}) canceled event`,
    });
    return json({ ok: true });
  }

  // ---- activity log (STAFF+) ----
  if (path === '/api/activity' && method === 'GET') {
    const ctx = await requireRole(request, env, 'STAFF');
    if (!ctx) return json({ error: 'forbidden' }, 403);
    const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
    const rows = await env.DB.prepare(
      'SELECT id, type, detail, created_at FROM activity_log WHERE business_id=? ORDER BY created_at DESC LIMIT ?'
    ).bind(ctx.businessId, limit).all();
    return json({ activity: rows.results || [] });
  }

  // ---- dashboard home: one aggregate call (STAFF+) ----
  if (path === '/api/business/home' && method === 'GET') {
    const ctx = await requireRole(request, env, 'STAFF');
    if (!ctx) return json({ error: 'forbidden' }, 403);
    const biz = await env.DB.prepare(
      'SELECT slug,name,blurb,full_description,logo,address,phone,category,modules,product_slugs,is_public FROM businesses WHERE id=?'
    ).bind(ctx.businessId).first();
    if (!biz) return json({ error: 'not_found' }, 404);
    const modules = parse(biz.modules, {});
    const pslugs = parse(biz.product_slugs, {});

    // Best-effort Herald signal (hours/announcement) — degrades like /api/public/town already does.
    let hoursToday = null, announcement = null;
    if (modules.herald) {
      try {
        const r = await fetch(`${PRODUCTS.herald.origin}/api/public/businesses/${pslugs.herald || biz.slug}/feed`, { cf: { cacheTtl: 60 } });
        if (r.ok) {
          const f = await r.json();
          hoursToday = f.hours || null;
          announcement = f.announcement || null;
        }
      } catch { /* degrade — this widget just shows less, the dashboard still loads */ }
    }

    const draftEvents = await env.DB.prepare(
      'SELECT COUNT(*) as c FROM town_events WHERE business_id=? AND is_published=0'
    ).bind(ctx.businessId).first();
    const recent = await env.DB.prepare(
      'SELECT id, type, detail, created_at FROM activity_log WHERE business_id=? ORDER BY created_at DESC LIMIT 5'
    ).bind(ctx.businessId).all();
    const pendingInvites = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM business_invitations WHERE business_id=? AND status='pending'"
    ).bind(ctx.businessId).first();

    const attention = [];
    if (!hoursToday || hoursToday.status === 'unknown') attention.push({ key: 'hours', message: 'Customers cannot see your hours yet.', action: 'hours' });
    if (!biz.blurb && !biz.full_description) attention.push({ key: 'description', message: 'Your listing has no description yet.', action: 'profile' });
    if (!biz.logo) attention.push({ key: 'logo', message: 'Add your logo so customers recognize your business.', action: 'profile' });
    if (!biz.is_public) attention.push({ key: 'public', message: 'Your listing is hidden from the public directory.', action: 'profile' });
    if (pendingInvites.c > 0) attention.push({ key: 'invites', message: `${pendingInvites.c} team invitation${pendingInvites.c > 1 ? 's' : ''} still pending.`, action: 'team' });
    if (draftEvents.c > 0) attention.push({ key: 'events', message: `${draftEvents.c} event draft${draftEvents.c > 1 ? 's' : ''} waiting to be published.`, action: 'events' });

    return json({
      name: biz.name,
      today: { hours: hoursToday, announcement },
      needs_attention: attention,
      draft_event_count: draftEvents.c || 0,
      recent_activity: recent.results || [],
    });
  }

  // ---- authenticated public-listing preview (STAFF+) — reuses buildPublicProjection
  // so this can never drift from what /api/public/town actually serves publicly ----
  if (path === '/api/business/preview' && method === 'GET') {
    const ctx = await requireRole(request, env, 'STAFF');
    if (!ctx) return json({ error: 'forbidden' }, 403);
    const b = await env.DB.prepare(
      `SELECT slug,name,category,blurb,website,logo,primary_color,forge_url,product_slugs,modules,is_public,
              subscription_status,
              primary_category,subcategory,tags,
              full_description,secondary_categories,address,service_area,phone,email,
              public_contact_preference,social_links,price_range,accessibility_info,parking_info,
              family_friendly,pet_friendly,appointment_required,service_notes
       FROM businesses WHERE id=?`
    ).bind(ctx.businessId).first();
    if (!b) return json({ error: 'not_found' }, 404);
    const projection = await buildPublicProjection(b);
    return json({ ...projection, is_public: !!b.is_public });
  }

  // ---- public: resolve an approved claim for the accept screen (no session yet) ----
  if (path.match(/^\/api\/claim\/[^/]+$/) && method === 'GET') {
    const code = path.split('/').pop();
    const claim = await env.DB.prepare(
      `SELECT lc.status, lc.accept_code_expires_at, b.name as business_name
       FROM listing_claims lc JOIN businesses b ON b.id = lc.business_id
       WHERE lc.accept_code=?`
    ).bind(code).first();
    if (!claim || claim.status !== 'approved' || new Date(claim.accept_code_expires_at) < new Date()) {
      return json({ error: 'invalid_or_expired_claim' }, 404);
    }
    return json({ business_name: claim.business_name });
  }

  // ---- public: redeem an approved claim, choose a PIN (this IS the login) ----
  if (path.match(/^\/api\/claim\/[^/]+\/accept$/) && method === 'POST') {
    const code = path.split('/')[3]; // ['', 'api', 'claim', ':code', 'accept']
    const b = await readBody(request);
    const claim = await env.DB.prepare('SELECT * FROM listing_claims WHERE accept_code=?').bind(code).first();
    if (!claim || claim.status !== 'approved' || new Date(claim.accept_code_expires_at) < new Date()) {
      return json({ error: 'invalid_or_expired_claim' }, 404);
    }
    const pin = String(b.pin || '').trim();
    if (!/^\d{4,8}$/.test(pin)) return json({ error: 'Choose a 4-8 digit PIN.' }, 400);

    // Mint a brand-new random-salt credential and overwrite BOTH the business's own
    // pin_hash/salt AND the new OWNER user row with it. Overwriting businesses.pin_hash
    // matters, not just cosmetically: the legacy login fallback trusts ANY existing
    // OWNER row once businesses.pin_hash matches the submitted PIN — it does not check
    // that the submitted PIN belongs to that specific owner. Leaving the old shared
    // placeholder hash in place would mean the old shared PIN still grants access via
    // that fallback even after a real claim. This also self-heals the Part A guard's
    // COUNT check toward 1 for this business.
    const salt = randomBytes(16).toString('hex');
    const pin_hash = hashPin(pin, salt);

    await env.DB.prepare('UPDATE businesses SET pin_hash=?, salt=?, claim_status=?, claimed_at=datetime(\'now\') WHERE id=?')
      .bind(pin_hash, salt, 'claimed', claim.business_id).run();
    const ins = await env.DB.prepare(
      "INSERT INTO users (business_id, name, pin_hash, salt, role) VALUES (?,?,?,?,'OWNER')"
    ).bind(claim.business_id, claim.claimant_name, pin_hash, salt).run();
    const newUserId = ins.meta.last_row_id;

    await env.DB.prepare(
      "UPDATE listing_claims SET status='completed', accepted_user_id=? WHERE id=?"
    ).bind(newUserId, claim.id).run();

    // This route SETS a PIN. The PIN, its hash, and its salt are never audited — only
    // that a claim was redeemed and a new credentialed OWNER now exists.
    await audit(env, request, {
      actor: 'public', action: 'claim.accept', entity_type: 'users', entity_id: newUserId,
      summary: `claim #${claim.id} redeemed — new OWNER user #${newUserId} created with a fresh PIN`,
    });

    const biz = await env.DB.prepare('SELECT slug, name, town, modules FROM businesses WHERE id=?').bind(claim.business_id).first();
    const session = signClassic({ slug: biz.slug, exp: Date.now() + TTL_MS, uid: newUserId, role: 'OWNER' }, env.SESSION_SECRET);
    return json(
      { slug: biz.slug, name: biz.name, town: biz.town, modules: parse(biz.modules, {}), role: 'OWNER', userId: newUserId, token: session },
      200,
      { 'Set-Cookie': cookie('ts_session', session, TTL_MS / 1000) }
    );
  }

  // ---- broker + proxy: /api/m/:product/<product-path> ----
  const m = path.match(/^\/api\/m\/([^/]+)(\/.*)?$/);
  if (m) {
    const key = m[1];
    const rest = m[2] || '/';
    const product = PRODUCTS[key];
    if (!product) return json({ module: key, ok: false, error: 'unknown_module' }, 404);

    const s = sessionFrom(request, env);
    if (!s) return json({ module: key, ok: false, error: 'unauthenticated' }, 401);

    const biz = await env.DB.prepare(
      'SELECT slug,modules,product_slugs,subscription_status FROM businesses WHERE slug=?'
    ).bind(s.slug).first();
    if (!biz) return json({ module: key, ok: false, error: 'unauthenticated' }, 401);
    if (!parse(biz.modules, {})[key]) return json({ module: key, ok: false, error: 'not_enrolled' }, 403);
    // A lapsed subscription is READ-ONLY, not revoked: GET/HEAD still reach the product so
    // the owner can see everything they wrote. Only writes are refused, with 402 (distinct
    // from not_enrolled so the dashboard can tell "lapsed" from "never subscribed").
    const isRead = request.method === 'GET' || request.method === 'HEAD';
    if (!isRead && !subscriptionActive(biz)) {
      return json({
        module: key,
        ok: false,
        error: 'subscription_inactive',
        subscription_status: biz.subscription_status || null,
      }, 402);
    }

    const pslug = parse(biz.product_slugs, {})[key] || biz.slug;
    const secret = env[product.secret];
    if (!secret) return json({ module: key, ok: false, error: 'module_unconfigured' }, 502);

    const token = product.fmt === 'sec'
      ? signHearth({ scope: product.scope, slug: pslug }, secret)
      : signClassic({ scope: product.scope, slug: pslug, exp: Date.now() + TTL_MS }, secret);

    const fwdHeaders = new Headers(request.headers);
    fwdHeaders.set('Authorization', 'Bearer ' + token);
    fwdHeaders.delete('cookie');

    let upstream;
    try {
      upstream = await fetch(product.origin + rest + url.search, {
        method,
        headers: fwdHeaders,
        body: method === 'GET' || method === 'HEAD' ? undefined : await request.clone().arrayBuffer(),
      });
    } catch (err) {
      // loose coupling: a product outage degrades ONLY this module
      return json({ module: key, ok: false, error: 'module_unreachable', detail: String(err) }, 503);
    }

    // Audit brokered MUTATIONS only (GET/HEAD reads would drown the log). This is
    // the sole path by which a hub session changes anything inside Herald /
    // Drawbridge / Belltower / Hearth — including PIN changes, which have no hub
    // endpoint of their own. We record the ENVELOPE (product, method, path, whose
    // account) and never the request body, which is exactly where a new PIN or OTP
    // would be. `rest` is the product-side path; url.search is dropped for the same
    // reason. Logged after the call so a failed proxy isn't recorded as a change.
    if (method !== 'GET' && method !== 'HEAD' && upstream.ok) {
      await audit(env, request, {
        actor: biz.slug, action: `broker.${key}.mutate`, entity_type: `${key}.proxy`, entity_id: pslug,
        summary: `${method} ${rest} brokered to ${key} for ${pslug} (status ${upstream.status})`,
      });
    }

    const respHeaders = new Headers(upstream.headers);
    respHeaders.delete('set-cookie'); // never leak a product cookie to the browser
    for (const [k, v] of Object.entries(cors())) respHeaders.set(k, v);
    return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
  }

  return json({ error: 'not_found' }, 404);
}

// ---- shared public projection --------------------------------------------
// Shapes one business row (slug,name,category,blurb,website,logo,primary_color,
// forge_url,product_slugs,modules) into what the public town feed shows, pulling
// best-effort live signals from each enrolled product. Used by BOTH the real
// public feed (/api/public/town) and the authenticated owner preview
// (/api/business/preview) so the preview can never drift from what's actually
// shown publicly — one code path, not two copies that could disagree.
async function buildPublicProjection(b) {
  const enrolled = parse(b.modules, {});
  // Paid features are gated on an active subscription. A lapse must NEVER delete
  // anything — we simply stop PUBLISHING the paid signals. `businesses.modules` and the
  // owner's content in Herald/Drawbridge stay untouched, and everything reappears the
  // moment the subscription is active again. Treating the whole map as empty gates the
  // signal fetches, the links map, and the modules echo in one place.
  const paidActive = subscriptionActive(b);
  const modules = paidActive ? enrolled : {};
  const pslugs = parse(b.product_slugs, {});
  const live = {};

  if (modules.drawbridge) {
    try {
      const r = await fetch(`${PRODUCTS.drawbridge.origin}/api/menu/${pslugs.drawbridge || b.slug}`, { cf: { cacheTtl: 120 } });
      if (r.ok) {
        const m = await r.json();
        live.open_now = m.open_now;
        live.specials = (m.specials || []).map((s) => ({ name: s.name, price: s.price })).slice(0, 6);
      }
    } catch { /* skip signal */ }
  }
  if (modules.herald) {
    try {
      const r = await fetch(`${PRODUCTS.herald.origin}/api/public/businesses/${pslugs.herald || b.slug}/feed`, { cf: { cacheTtl: 120 } });
      if (r.ok) {
        const f = await r.json();
        if (f.announcement && f.announcement.text) live.announcement = f.announcement.text;
        if (f.hours) {
          // Only ever surface a REAL, owner-written note. Never fall back to the raw
          // status enum: 'closed'/'unknown' are internal values, and publishing them
          // rendered as "📣 closed" / "📣 unknown" announcements attributed to real
          // institutions on the Town Board and in the Town Crier. The status itself is
          // already carried structurally in live.hours_today below.
          const note = typeof f.hours.note === 'string' ? f.hours.note.trim() : '';
          if (note && f.hours.status !== 'open') live.hours_note = note;
          live.hours_today = {
            status: f.hours.status || null, open: f.hours.open_time || null, close: f.hours.close_time || null,
            is_24h: !!f.hours.is_24h, appointment_only: !!f.hours.appointment_only,
          };
        }
        if (Array.isArray(f.posts) && f.posts.length) {
          live.social_posts = f.posts.map((p) => ({
            author: b.name,
            text: p.text,
            image: p.image || null,
            time: p.created_at,
            type: p.source === 'facebook' ? 'facebook' : 'update',
          }));
        }
      }
    } catch { /* skip signal */ }
  }
  if (modules.hearth) {
    try {
      const r = await fetch(`${PRODUCTS.hearth.origin}/api/public/rating/${pslugs.hearth || b.slug}`, { cf: { cacheTtl: 300 } });
      if (r.ok) {
        const d = await r.json();
        if (d && d.count > 0) { live.rating = d.avg_rating; live.ratings = d.count; }
      }
    } catch { /* skip signal */ }
  }
  if (modules.belltower) {
    try {
      const r = await fetch(`${PRODUCTS.belltower.origin}/api/business/${pslugs.belltower || b.slug}/next?days=3`, { cf: { cacheTtl: 120 } });
      if (r.ok) {
        const d = await r.json();
        if (d && d.next_slot) { live.next_slot = d.next_slot; live.next_service = d.service || null; }
      }
    } catch { /* skip signal */ }
  }

  return {
    slug: b.slug, name: b.name, category: b.category, blurb: b.blurb,
    logo: b.logo, primary_color: b.primary_color, modules,
    // Full yellow-pages profile (added Phase 1) — same gate as everything else here:
    // only ever reached for is_public=1 rows (the public feed's WHERE clause) or the
    // owner's own authenticated preview, never a draft/private business.
    full_description: b.full_description || null,
    secondary_categories: parse(b.secondary_categories, []),
    address: b.address || null,
    service_area: b.service_area || null,
    phone: b.phone || null,
    email: b.email || null,
    public_contact_preference: b.public_contact_preference || null,
    social_links: parse(b.social_links, {}),
    price_range: b.price_range || null,
    accessibility_info: b.accessibility_info || null,
    parking_info: b.parking_info || null,
    family_friendly: b.family_friendly === null || b.family_friendly === undefined ? null : !!b.family_friendly,
    pet_friendly: b.pet_friendly === null || b.pet_friendly === undefined ? null : !!b.pet_friendly,
    appointment_required: b.appointment_required === null || b.appointment_required === undefined ? null : !!b.appointment_required,
    service_notes: b.service_notes || null,
    // Directory classification is BASIC listing data — like name and address it
    // publishes regardless of subscription state (only paid `modules` are gated).
    primary_category: b.primary_category || null,
    subcategory: b.subcategory || null,
    tags: parse(b.tags, []),
    links: {
      website: b.website || null,
      menu: modules.drawbridge ? `${PRODUCTS.drawbridge.origin}/menu/${pslugs.drawbridge || b.slug}` : null,
      book: modules.belltower ? `${PRODUCTS.belltower.origin}/book/?b=${pslugs.belltower || b.slug}` : null,
      forge: modules.forge ? (b.forge_url || 'https://gettheforge.app') : null,
    },
    live,
  };
}

// ---- token minting (byte-compatible with each product) --------------------
function b64url(s) { return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function b64urlDecode(s) { return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(); }

function signClassic(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(body).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return body + '.' + sig;
}
function signHearth(payload, secret) {
  const body = b64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 12 * 3600 }));
  const sig = createHmac('sha256', secret).update(body).digest('hex');
  return body + '.' + sig;
}
// TownSquare session uses the classic (ms/base64url) format with its OWN secret.
function verifyClassic(token, secret) {
  if (!token || !secret || token.indexOf('.') < 0) return null;
  const i = token.lastIndexOf('.');
  const body = token.slice(0, i), sig = token.slice(i + 1);
  const expected = createHmac('sha256', secret).update(body).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let p; try { p = JSON.parse(b64urlDecode(body)); } catch { return null; }
  if (!p || !p.exp || Date.now() > p.exp) return null;
  return p;
}
function sessionFrom(request, env) {
  // Bearer token (cross-origin owner UI) takes precedence, then the httpOnly cookie (same-site SPA).
  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.match(/^Bearer\s+(.+)$/i);
  if (bearer) { const p = verifyClassic(bearer[1].trim(), env.SESSION_SECRET); if (p) return p; }
  const c = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)ts_session=([^;]+)/);
  return c ? verifyClassic(decodeURIComponent(c[1]), env.SESSION_SECRET) : null;
}

// ---- role enforcement (Phase 1 team/roles) ---------------------------------
// Every mutation re-derives role from the DB — the token's `role` claim is a UI
// hint only, never trusted for authorization. Mirrors the pattern every other
// protected handler in this file already uses (re-query by slug, not by trusting
// token contents). `businessId` on the returned ctx is what every subsequent
// query should filter on — never a business id read from the request body.
const ROLE_RANK = { STAFF: 0, MANAGER: 1, OWNER: 2 };
async function requireRole(request, env, minRole) {
  const s = sessionFrom(request, env);
  if (!s || !s.uid) return null; // also rejects pre-migration tokens missing uid
  const user = await env.DB.prepare('SELECT id, business_id, role, is_active FROM users WHERE id=?').bind(s.uid).first();
  if (!user || !user.is_active) return null;
  const biz = await env.DB.prepare('SELECT id, slug FROM businesses WHERE id=? AND slug=?').bind(user.business_id, s.slug).first();
  if (!biz) return null; // tamper/cross-business check: token's slug must match the user's real business
  if (ROLE_RANK[user.role] === undefined || ROLE_RANK[user.role] < ROLE_RANK[minRole]) return null;
  return { userId: user.id, businessId: biz.id, slug: biz.slug, role: user.role };
}

// ---- activity log (Phase 1) ------------------------------------------------
// Closed vocabulary of `type` values written across the endpoints below:
// login, profile_updated, hours_updated, event_created, event_published,
// event_canceled, event_deleted, team_invited, team_role_changed, team_removed.
async function logActivity(env, businessId, type, detail) {
  try {
    await env.DB.prepare('INSERT INTO activity_log (business_id, type, detail) VALUES (?,?,?)')
      .bind(businessId, type, detail == null ? null : String(detail)).run();
  } catch { /* best-effort — never block the real mutation on a logging failure */ }
}

// ---- audit log (internal-only mutation trail) ------------------------------
// Distinct from activity_log above, which is a per-business feed the OWNER reads
// in their dashboard. audit_log is INTERNAL: no route in this file reads it, and
// none should be added. It exists to answer "who changed this, when, and what"
// for every write path — including the two activity_log never covered: the
// square-admin event DELETE (shared PIN) and the public self-serve join.
//
// NEVER logged here: PINs, PIN hashes, salts, OTPs, session tokens, invite codes,
// phone numbers, email addresses, or raw IPs. When in doubt a field is omitted.
// Actor sentinels: 'admin' (square PIN), 'public' (unauthenticated), 'system'.
//
// Like logActivity, this is best-effort by contract: a logging failure must never
// fail the real mutation. Every call is awaited inside its own try/catch and
// swallowed, so the caller's success path is unchanged whether or not the row
// lands. Callers therefore never need to guard an audit() call themselves.
async function audit(env, request, entry) {
  try {
    const { actor, action, entity_type = null, entity_id = null, summary = null } = entry;
    await env.DB.prepare(
      `INSERT INTO audit_log (ts, actor, action, entity_type, entity_id, summary, ip_hash, request_id)
       VALUES (?,?,?,?,?,?,?,?)`
    ).bind(
      new Date().toISOString(),
      String(actor),
      String(action),
      entity_type == null ? null : String(entity_type),
      entity_id == null ? null : String(entity_id),
      summary == null ? null : String(summary).slice(0, 300),
      hashIp(request, env),
      request ? (request.headers.get('CF-Ray') || null) : null,
    ).run();
  } catch { /* best-effort — never block or fail the real mutation on a logging error */ }
}

// Keyed HMAC of the client IP, truncated. A PLAIN hash would be pointless here:
// IPv4 is ~4.3e9 values, so sha256(ip) is brute-forced back to the raw address in
// seconds. Keying it with a Worker secret makes the digest correlatable (the same
// visitor hashes the same way) without being reversible. Falls back to
// SESSION_SECRET so the audit trail still works before AUDIT_IP_SALT is set;
// returns null rather than a raw IP if neither secret exists.
function hashIp(request, env) {
  try {
    if (!request) return null;
    const key = env.AUDIT_IP_SALT || env.SESSION_SECRET;
    if (!key) return null;
    const ip = clientIp(request);
    if (!ip || ip === 'unknown') return null;
    return createHmac('sha256', key).update(ip).digest('hex').slice(0, 16);
  } catch { return null; }
}

// ---- PIN auth (per-account random salt — fixes the products' static salt) --
function hashPin(pin, saltHex) {
  return scryptSync(String(pin), Buffer.from(saltHex, 'hex'), 32, { N: 16384, r: 8, p: 1 }).toString('hex');
}
function verifyPin(pin, saltHex, hashHex) {
  if (!saltHex || !hashHex) return false;
  const a = Buffer.from(hashPin(pin, saltHex), 'hex'), b = Buffer.from(hashHex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
// Products (Herald/Drawbridge) hash PINs with a STATIC zero salt. We compute this too,
// so the same PIN the owner picks works via the hub broker AND directly in each product.
function hashPinStatic(pin) {
  return scryptSync(String(pin), Buffer.alloc(16, 0), 32, { N: 16384, r: 8, p: 1 }).toString('hex');
}

// ---- self-serve provisioning helpers --------------------------------------
function slugify(name) {
  return String(name || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'business';
}
async function uniqueSlug(env, base) {
  let slug = base, n = 1;
  while (await env.DB.prepare('SELECT 1 FROM businesses WHERE slug=?').bind(slug).first()) { slug = `${base}-${++n}`; }
  return slug;
}
// Verify a PayPal subscription is real and active via the REST API (server-side, so a
// spoofed client onApprove can't mint a free account). Needs PAYPAL_CLIENT_ID/SECRET secrets.
async function verifyPayPalSubscription(env, subId) {
  const id = env.PAYPAL_CLIENT_ID || PAYPAL_LIVE_CLIENT_ID, secret = env.PAYPAL_SECRET;
  if (!id || !secret) return { ok: false, error: 'paypal_unconfigured' };
  if (!subId) return { ok: false, error: 'missing_subscription' };
  const base = env.PAYPAL_API_BASE || 'https://api-m.paypal.com';
  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const tok = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  }).then((r) => r.json()).catch(() => null);
  if (!tok || !tok.access_token) return { ok: false, error: 'paypal_auth_failed' };
  const sub = await fetch(`${base}/v1/billing/subscriptions/${encodeURIComponent(subId)}`, {
    headers: { Authorization: 'Bearer ' + tok.access_token },
  }).then((r) => r.json()).catch(() => null);
  if (!sub || !sub.id) return { ok: false, error: 'subscription_not_found' };
  if (sub.status !== 'ACTIVE' && sub.status !== 'APPROVED') return { ok: false, error: 'subscription_not_active', status: sub.status };
  return { ok: true, plan_id: sub.plan_id || null, status: sub.status, subscriber: sub.subscriber || null };
}

// ---- subscription gating -----------------------------------------------------
// SINGLE source of truth for "may this business use paid features?". Every gate
// (publishing, broker writes, dashboard) must call this and nothing else.
//
//   comped        - community orgs + Chrissy's own listings; free forever.
//   grandfathered - existed before subscriptions were enforced; never regressed.
//   active        - a PayPal subscription verified ACTIVE.
// Anything else (cancelled/suspended/past_due, or NULL on a row created after the
// migration) is inactive. Inactive means READ-ONLY — never deletion.
function subscriptionActive(biz) {
  if (!biz) return false;
  const s = biz.subscription_status;
  return s === 'comped' || s === 'grandfathered' || s === 'active';
}
// Statuses PayPal owns. Comped/grandfathered are ours and must never be overwritten
// by a PayPal re-check, or a lapsed card would silently dark a comped community org.
function subscriptionIsPayPalManaged(biz) {
  const s = biz && biz.subscription_status;
  return s !== 'comped' && s !== 'grandfathered';
}
// Re-check a PayPal-managed subscription and persist the result. Best-effort: on any
// PayPal/network failure we KEEP the stored status rather than downgrading, so an
// outage can never lock a paying owner out of their own dashboard.
async function refreshSubscription(env, biz, { maxAgeMs = 24 * 3600 * 1000 } = {}) {
  if (!biz || !subscriptionIsPayPalManaged(biz) || !biz.subscription_id) return biz;
  const last = biz.subscription_checked_at ? Date.parse(biz.subscription_checked_at + 'Z') : 0;
  if (last && Date.now() - last < maxAgeMs) return biz;
  const pp = await verifyPayPalSubscription(env, biz.subscription_id);
  let next = biz.subscription_status;
  if (pp.ok) next = 'active';
  else if (pp.error === 'subscription_not_active') {
    next = { CANCELLED: 'cancelled', SUSPENDED: 'suspended', EXPIRED: 'cancelled' }[pp.status] || 'past_due';
  } else return biz; // unconfigured / auth failure / network — do not downgrade
  try {
    await env.DB.prepare(
      "UPDATE businesses SET subscription_status=?, subscription_checked_at=datetime('now') WHERE id=?"
    ).bind(next, biz.id).run();
  } catch { /* best-effort */ }
  return { ...biz, subscription_status: next };
}

// ---- listing-form helpers (rate limit + best-effort email) --------------------
function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
}
// 3 submissions per IP per hour, shared ledger. Records a hit on each accepted attempt.
async function rateOk(env, ip, form) {
  try {
    const r = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM form_hits WHERE ip=? AND form=? AND created_at > datetime('now','-1 hour')"
    ).bind(ip, form).first();
    if (r && r.c >= 3) return false;
    await env.DB.prepare('INSERT INTO form_hits (ip, form) VALUES (?,?)').bind(ip, form).run();
    return true;
  } catch { return true; } // never block a real submission on rate-limit infra trouble
}
// Best-effort notify. Pages can't send email directly, so we POST to the standalone
// tsq-mailer Worker (which holds the send_email binding) with a shared Bearer secret.
// No-op until MAILER_URL + MAILER_SECRET are set; the submission is already saved either way.
async function notify(env, subject, body) {
  try {
    if (!env.MAILER_URL || !env.MAILER_SECRET) return;
    await fetch(env.MAILER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.MAILER_SECRET },
      body: JSON.stringify({ subject, body }),
    });
  } catch { /* best-effort — submission is already stored + visible in admin */ }
}

// ---- claim flow: outbound email to an arbitrary claimant --------------------
// notify()/tsq-mailer above is a single-destination internal-alert pipe (Cloudflare's
// send_email binding only supports one pre-verified recipient) and cannot email a
// claimant. Resend can, and is already live in Belltower/Hearth for real customer
// email — this mirrors that exact pattern. No-ops cleanly (never throws, never blocks
// the caller) if RESEND_API_KEY isn't set, matching notify()'s degrade convention:
// the claim row is still saved and visible to an admin even if the email never sends.
// Business names/descriptions are user-submitted and get interpolated into HTML email,
// so escape them: an unescaped "&" or "<" breaks rendering at best, injects at worst.
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// `fromUser` is optional and defaults to 'claims' so every existing caller is unchanged;
// listing/signup mail uses 'hello' since "claims@" reads oddly on a welcome message.
async function sendEmail(env, to, subject, html, fromUser) {
  if (!env.RESEND_API_KEY || !to) return { sent: false, skipped: true };
  const domain = env.EMAIL_DOMAIN || 'foreverstillstudio.com';
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `TownSquare <${fromUser || 'claims'}@${domain}>`, to: [to], subject, html }),
    });
    return { sent: r.ok, status: r.status };
  } catch (e) { return { sent: false, error: String(e) }; }
}

// ---- claim flow: OTP mechanics (mirrors Hearth's production otp_codes pattern) --
// 6-digit numeric code, HMAC-hashed (never stores the raw code), 10-min expiry,
// 5-attempt lock, single-use. Keyed by claim_id, not email — every query below is
// scoped to one claim, so business isolation is structural, not a policy check.
function genOtpCode() {
  // 100000-999999, always 6 digits.
  return String(100000 + Math.floor(Math.random() * 900000));
}
function hashOtpCode(code, secret) {
  return createHmac('sha256', secret).update(String(code)).digest('hex');
}
async function verifyOtpCode(env, claimId, code) {
  const row = await env.DB.prepare(
    'SELECT id, code_hash, attempts, expires_at, used_at FROM claim_otp_codes WHERE claim_id=? ORDER BY id DESC LIMIT 1'
  ).bind(claimId).first();
  if (!row || row.used_at) return { ok: false, error: 'invalid_code' };
  if (new Date(row.expires_at) < new Date()) return { ok: false, error: 'expired_code' };
  if (row.attempts >= 5) return { ok: false, error: 'too_many_attempts' };

  const submitted = Buffer.from(hashOtpCode(String(code || ''), env.SESSION_SECRET));
  const stored = Buffer.from(row.code_hash);
  const match = submitted.length === stored.length && timingSafeEqual(submitted, stored);
  if (!match) {
    await env.DB.prepare('UPDATE claim_otp_codes SET attempts=attempts+1 WHERE id=?').bind(row.id).run();
    return { ok: false, error: 'wrong_code' };
  }
  await env.DB.prepare("UPDATE claim_otp_codes SET used_at=datetime('now') WHERE id=?").bind(row.id).run();
  return { ok: true };
}

// ---- misc -----------------------------------------------------------------
function cookie(name, val, maxAgeSec) {
  return `${name}=${encodeURIComponent(val)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`;
}
function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}
function parse(s, dflt) { try { return s ? JSON.parse(s) : dflt; } catch { return dflt; } }
async function readBody(request) { try { return await request.json(); } catch { return {}; } }
function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors(), ...extra } });
}

// ---- named exports for unit tests (alongside the default Pages export) ----
export { hashPin, verifyPin, hashPinStatic, signClassic, verifyClassic, requireRole, ROLE_RANK, genOtpCode, hashOtpCode };
