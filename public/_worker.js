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

import { createHmac, scryptSync, timingSafeEqual } from 'crypto';

const PRODUCTS = {
  herald:     { origin: 'https://theherald.pages.dev', scope: 'business', secret: 'HERALD_SECRET',     fmt: 'ms'  },
  drawbridge: { origin: 'https://getdrawbridge.app',   scope: 'keep',     secret: 'DRAWBRIDGE_SECRET', fmt: 'ms'  },
  belltower:  { origin: 'https://getbelltower.app',    scope: 'belfry',   secret: 'BELLTOWER_SECRET',  fmt: 'ms'  },
  hearth:     { origin: 'https://hearth-c7a.pages.dev', scope: 'hall',    secret: 'HEARTH_SECRET',     fmt: 'sec' },
  // forge is NOT brokered — it's a launch-tile/deep-link only (see project-architecture.md §3a)
};
const TTL_MS = 12 * 3600 * 1000;

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

async function api(request, env, url) {
  const path = url.pathname;
  const method = request.method;
  if (method === 'OPTIONS') return new Response(null, { headers: cors() });

  // ---- auth: login (sets httpOnly session cookie; no token reaches JS) ----
  if (path === '/api/auth/login' && method === 'POST') {
    const { slug, pin } = await readBody(request);
    const biz = await env.DB.prepare('SELECT * FROM businesses WHERE slug=?').bind(slug).first();
    if (!biz || !verifyPin(pin, biz.salt, biz.pin_hash)) return json({ error: 'invalid_login' }, 401);
    const session = signClassic({ slug: biz.slug, exp: Date.now() + TTL_MS }, env.SESSION_SECRET);
    return json(
      { slug: biz.slug, name: biz.name, town: biz.town, modules: parse(biz.modules, {}) },
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
    return json({ slug: biz.slug, name: biz.name, town: biz.town, modules: parse(biz.modules, {}) });
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
      "SELECT id,title,starts_at,ends_at,location,description FROM town_events WHERE town=? AND is_published=1 AND starts_at >= datetime('now','-1 day') ORDER BY starts_at"
    ).bind(town).all();
    return json({ town, events: rows.results || [] });
  }

  // Enriched town feed for the community app: registry directory + live signals
  // (Drawbridge open/specials, Herald announcements) + events, in one cached call.
  // Each product call is best-effort — a product outage just drops that signal.
  if (path === '/api/public/town' && method === 'GET') {
    const town = url.searchParams.get('town') || 'titusville';
    const rows = await env.DB.prepare(
      'SELECT slug,name,category,blurb,website,logo,primary_color,forge_url,product_slugs,modules FROM businesses WHERE town=? AND is_public=1 ORDER BY name'
    ).bind(town).all();

    const businesses = await Promise.all((rows.results || []).map(async (b) => {
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
            if (f.hours && f.hours.status && f.hours.status !== 'open') live.hours_note = f.hours.note || f.hours.status;
          }
        } catch { /* skip signal */ }
      }

      return {
        slug: b.slug, name: b.name, category: b.category, blurb: b.blurb,
        logo: b.logo, primary_color: b.primary_color, modules,
        links: {
          website: b.website || null,
          menu: modules.drawbridge ? `${PRODUCTS.drawbridge.origin}/menu/${pslugs.drawbridge || b.slug}` : null,
          book: modules.belltower ? `${PRODUCTS.belltower.origin}/book/?b=${pslugs.belltower || b.slug}` : null,
          forge: modules.forge ? (b.forge_url || 'https://gettheforge.app') : null,
        },
        live,
      };
    }));

    const ev = await env.DB.prepare(
      "SELECT id,title,starts_at,ends_at,location,description FROM town_events WHERE town=? AND is_published=1 AND starts_at >= datetime('now','-1 day') ORDER BY starts_at LIMIT 50"
    ).bind(town).all();

    return json({ town, businesses, events: ev.results || [] }, 200, { 'Cache-Control': 'public, max-age=120' });
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
  const c = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)ts_session=([^;]+)/);
  return c ? verifyClassic(decodeURIComponent(c[1]), env.SESSION_SECRET) : null;
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
