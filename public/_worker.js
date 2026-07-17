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
    const biz = await env.DB.prepare('SELECT * FROM businesses WHERE slug=?').bind(slug).first();
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
        "SELECT id, role FROM users WHERE business_id=? AND role='OWNER' ORDER BY id LIMIT 1"
      ).bind(biz.id).first();
      if (!owner) {
        await env.DB.prepare(
          "INSERT INTO users (business_id, name, pin_hash, salt, role) VALUES (?,?,?,?,'OWNER')"
        ).bind(biz.id, biz.name, biz.pin_hash, biz.salt).run();
        owner = await env.DB.prepare(
          "SELECT id, role FROM users WHERE business_id=? AND role='OWNER' ORDER BY id LIMIT 1"
        ).bind(biz.id).first();
      }
      user = owner;
    }

    await env.DB.prepare("UPDATE users SET last_login_at=datetime('now') WHERE id=?").bind(user.id).run();
    await logActivity(env, biz.id, 'login', user.role);

    const session = signClassic({ slug: biz.slug, exp: Date.now() + TTL_MS, uid: user.id, role: user.role }, env.SESSION_SECRET);
    // `token` lets a cross-origin owner UI (e.g. titusvillesquare.com/manage.html) authenticate
    // via Authorization: Bearer, since the httpOnly cookie can't ride cross-site.
    return json(
      { slug: biz.slug, name: biz.name, town: biz.town, modules: parse(biz.modules, {}), role: user.role, userId: user.id, token: session },
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
    const biz = await env.DB.prepare('SELECT slug,name,town,modules FROM businesses WHERE slug=?').bind(s.slug).first();
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
    });
  }

  // ---- public yellow-pages (no auth) ----
  if (path === '/api/public/directory' && method === 'GET') {
    const town = url.searchParams.get('town') || 'titusville';
    const rows = await env.DB.prepare(
      'SELECT slug,name,category,blurb,address,phone,website,logo,primary_color,forge_url,modules FROM businesses WHERE town=? AND is_public=1 ORDER BY name'
    ).bind(town).all();
    return json({ town, businesses: (rows.results || []).map((b) => ({ ...b, modules: parse(b.modules, {}) })) });
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
    await env.DB.prepare(
      "INSERT INTO town_events (town, title, starts_at, ends_at, location, description, is_published, is_kids, source) VALUES (?,?,?,?,?,?,0,?, 'submitted')"
    ).bind(town, title, starts_at, ends_at, location, description, is_kids).run();
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
    await env.DB.prepare(
      "INSERT INTO businesses (slug,name,town,pin_hash,salt,modules,category,blurb,phone,website,email,subscription_id,created_via,is_public) VALUES (?,?,'titusville',?,?,?,?,?,?,?,?,?,'self-serve',1)"
    ).bind(slug, name, hubHash, salt, modules, category, blurb, phone, website, email, subId).run();

    // 5) Provision the product accounts (best-effort; a product hiccup shouldn't undo a paid signup).
    const warn = [];
    try { await env.HERALD_DB.prepare('INSERT OR IGNORE INTO businesses (name,slug,pin_hash) VALUES (?,?,?)').bind(name, slug, prodHash).run(); }
    catch (e) { warn.push('herald:' + String(e)); }
    try { await env.DRAWBRIDGE_DB.prepare('INSERT OR IGNORE INTO restaurants (slug,name,pin_hash,is_open) VALUES (?,?,?,1)').bind(slug, name, prodHash).run(); }
    catch (e) { warn.push('drawbridge:' + String(e)); }

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
    await env.DB.prepare(
      'INSERT INTO listing_submissions (name,category,address,phone,email,website,hours,description,want_audit,ip) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).bind(name, category, address, phone, email, website, hours, description, want_audit, ip).run();
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
    await env.DB.prepare(
      'INSERT INTO listing_requests (business_name,requester,email,relationship,kind,details,ip) VALUES (?,?,?,?,?,?,?)'
    ).bind(business_name, requester, email, relationship, kind, details, ip).run();
    const tag = kind === 'remove' ? '[REMOVAL]' : '[CORRECTION]';
    await notify(env, `${tag} ${business_name}`,
      `${tag}\nBusiness: ${business_name}\nFrom: ${requester} (${relationship || '-'})\nEmail: ${email}\n\n${details || '(no details given)'}\n\nTriage: https://titusvillesquare.com/manage-events.html`);
    return json({ ok: true });
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
      return json({ ok: true });
    }
    if (act === 'kids' && b.id) {
      await env.DB.prepare('UPDATE town_events SET is_kids=? WHERE id=?').bind(b.kids ? 1 : 0, b.id).run();
      return json({ ok: true });
    }
    if (act === 'delete' && b.id) {
      await env.DB.prepare('DELETE FROM town_events WHERE id=?').bind(b.id).run();
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
    if (act === 'sub-status' && b.id && /^(pending|approved|rejected)$/.test(b.status || '')) {
      await env.DB.prepare('UPDATE listing_submissions SET status=? WHERE id=?').bind(b.status, b.id).run();
      return json({ ok: true });
    }
    if (act === 'req-status' && b.id && /^(open|resolved)$/.test(b.status || '')) {
      await env.DB.prepare('UPDATE listing_requests SET status=? WHERE id=?').bind(b.status, b.id).run();
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
      return json({ ok: true });
    }

    if (body.role !== undefined) {
      if (!['OWNER', 'MANAGER', 'STAFF'].includes(body.role)) return json({ error: 'bad_role' }, 400);
      await env.DB.prepare('UPDATE users SET role=? WHERE id=?').bind(body.role, targetId).run();
      await logActivity(env, ctx.businessId, 'team_role_changed', `${targetId} -> ${body.role}`);
    }
    if (body.is_active !== undefined) {
      await env.DB.prepare('UPDATE users SET is_active=? WHERE id=?').bind(body.is_active ? 1 : 0, targetId).run();
      if (!body.is_active) await logActivity(env, ctx.businessId, 'team_removed', targetId);
    }
    return json({ ok: true });
  }

  // ---- business profile: read (STAFF+) ----
  if (path === '/api/business/profile' && method === 'GET') {
    const ctx = await requireRole(request, env, 'STAFF');
    if (!ctx) return json({ error: 'forbidden' }, 403);
    const biz = await env.DB.prepare(
      `SELECT slug, name, town, category, blurb, full_description, secondary_categories, address,
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
    if (!sets.length) return json({ error: 'no_fields' }, 400);
    vals.push(ctx.businessId);
    await env.DB.prepare(`UPDATE businesses SET ${sets.join(', ')} WHERE id=?`).bind(...vals).run();
    await logActivity(env, ctx.businessId, 'profile_updated', Object.keys(b).join(','));
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
    await env.DB.prepare('DELETE FROM town_events WHERE id=?').bind(id).run();
    await logActivity(env, ctx.businessId, 'event_deleted', id);
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
              full_description,secondary_categories,address,service_area,phone,email,
              public_contact_preference,social_links,price_range,accessibility_info,parking_info,
              family_friendly,pet_friendly,appointment_required,service_notes
       FROM businesses WHERE id=?`
    ).bind(ctx.businessId).first();
    if (!b) return json({ error: 'not_found' }, 404);
    const projection = await buildPublicProjection(b);
    return json({ ...projection, is_public: !!b.is_public });
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

    const biz = await env.DB.prepare('SELECT slug,modules,product_slugs FROM businesses WHERE slug=?').bind(s.slug).first();
    if (!biz) return json({ module: key, ok: false, error: 'unauthenticated' }, 401);
    if (!parse(biz.modules, {})[key]) return json({ module: key, ok: false, error: 'not_enrolled' }, 403);

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
  const modules = parse(b.modules, {});
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
          if (f.hours.status && f.hours.status !== 'open') live.hours_note = f.hours.note || f.hours.status;
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
export { hashPin, verifyPin, hashPinStatic, signClassic, verifyClassic, requireRole, ROLE_RANK };
