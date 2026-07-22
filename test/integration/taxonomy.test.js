import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../public/_worker.js';
import { hashPin } from '../../public/_worker.js';
import { createTestD1 } from '../test-utils/d1.js';
import { call } from '../test-utils/worker.js';

const SECRET = 'test-secret';

async function seedOwner(env, slug, extra = '') {
  const salt = (slug + 'x'.repeat(32)).slice(0, 32);
  await env.DB.prepare(
    `INSERT INTO businesses (slug, name, pin_hash, salt, is_public${extra ? ', ' + extra.split('=')[0] : ''})
     VALUES (?,?,?,?,1${extra ? ',?' : ''})`
  ).bind(...[slug, slug, hashPin('1234', salt), salt].concat(extra ? [extra.split('=')[1]] : [])).run();
  const login = await call(worker, env, 'POST', '/api/auth/login', { body: { slug, pin: '1234' } });
  return login.data.token;
}

describe('directory taxonomy', () => {
  let env;
  beforeEach(() => {
    const { DB } = createTestD1();
    env = { DB, SESSION_SECRET: SECRET };
  });

  // ── owner PATCH validation ────────────────────────────────────────────────

  it('owner sets a valid primary + subcategory + tags', async () => {
    const token = await seedOwner(env, 'biz-cat');
    const res = await call(worker, env, 'PATCH', '/api/business/profile', {
      token, body: { primary_category: 'eat-drink', subcategory: 'bakeries-desserts', tags: ['Takeout', 'Kid Friendly'] },
    });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare('SELECT primary_category, subcategory, tags FROM businesses WHERE slug=?').bind('biz-cat').first();
    expect(row.primary_category).toBe('eat-drink');
    expect(row.subcategory).toBe('bakeries-desserts');
    expect(JSON.parse(row.tags)).toEqual(['Takeout', 'Kid Friendly']);
  });

  it('rejects an invented primary category', async () => {
    const token = await seedOwner(env, 'biz-bad');
    const res = await call(worker, env, 'PATCH', '/api/business/profile', {
      token, body: { primary_category: 'crypto-schemes' },
    });
    expect(res.status).toBe(400);
    expect(res.data.error).toBe('invalid_primary_category');
  });

  it('rejects a subcategory that does not belong to the primary', async () => {
    const token = await seedOwner(env, 'biz-mismatch');
    const res = await call(worker, env, 'PATCH', '/api/business/profile', {
      token, body: { primary_category: 'eat-drink', subcategory: 'automotive' },
    });
    expect(res.status).toBe(400);
    expect(res.data.error).toBe('invalid_subcategory');
  });

  it('silently drops unknown tags instead of failing the save', async () => {
    const token = await seedOwner(env, 'biz-tags');
    const res = await call(worker, env, 'PATCH', '/api/business/profile', {
      token, body: { primary_category: 'shop', tags: ['Delivery', 'Best In The Universe', 'Woman Owned'] },
    });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare('SELECT tags FROM businesses WHERE slug=?').bind('biz-tags').first();
    expect(JSON.parse(row.tags)).toEqual(['Delivery', 'Woman Owned']);
  });

  it('changing the primary without naming a sub clears the stale sub', async () => {
    const token = await seedOwner(env, 'biz-switch');
    await call(worker, env, 'PATCH', '/api/business/profile', {
      token, body: { primary_category: 'eat-drink', subcategory: 'restaurants' },
    });
    // Owner re-categorizes to Shop but sends no subcategory: 'restaurants' must
    // not survive under 'shop' — a sub only means something inside its primary.
    const res = await call(worker, env, 'PATCH', '/api/business/profile', {
      token, body: { primary_category: 'shop' },
    });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare('SELECT primary_category, subcategory FROM businesses WHERE slug=?').bind('biz-switch').first();
    expect(row.primary_category).toBe('shop');
    expect(row.subcategory).toBeNull();
  });

  it('a subcategory sent alone validates against the CURRENT primary', async () => {
    const token = await seedOwner(env, 'biz-subonly');
    await call(worker, env, 'PATCH', '/api/business/profile', {
      token, body: { primary_category: 'eat-drink' },
    });
    const ok = await call(worker, env, 'PATCH', '/api/business/profile', {
      token, body: { subcategory: 'cafes-coffee' },
    });
    expect(ok.status).toBe(200);
    const bad = await call(worker, env, 'PATCH', '/api/business/profile', {
      token, body: { subcategory: 'hotels' },
    });
    expect(bad.status).toBe(400);
  });

  // ── public feeds ──────────────────────────────────────────────────────────

  it('the public feeds expose classification, and unclassified listings still appear', async () => {
    const token = await seedOwner(env, 'biz-classified');
    await seedOwner(env, 'biz-unclassified'); // never classified — must still publish
    await call(worker, env, 'PATCH', '/api/business/profile', {
      token, body: { primary_category: 'eat-drink', subcategory: 'restaurants', tags: ['Outdoor Seating'] },
    });

    const dir = await call(worker, env, 'GET', '/api/public/directory?town=titusville');
    const classified = dir.data.businesses.find((b) => b.slug === 'biz-classified');
    const unclassified = dir.data.businesses.find((b) => b.slug === 'biz-unclassified');
    expect(classified.primary_category).toBe('eat-drink');
    expect(classified.subcategory).toBe('restaurants');
    expect(classified.tags).toEqual(['Outdoor Seating']);
    expect(unclassified, 'unclassified listings must never vanish from the feed').toBeTruthy();
    expect(unclassified.primary_category).toBeNull();
    expect(unclassified.tags).toEqual([]);
  });

  // ── admin review + override ───────────────────────────────────────────────

  it('admin sees unclassified listings and can classify them', async () => {
    const adminSalt = 'bb'.repeat(16);
    await env.DB.prepare('INSERT INTO businesses (slug, name, pin_hash, salt) VALUES (?,?,?,?)')
      .bind('titusville-square', 'titusville-square', hashPin('0777', adminSalt), adminSalt).run();
    await seedOwner(env, 'biz-review');

    const review = await call(worker, env, 'POST', '/api/square/listings', {
      body: { pin: '0777', action: 'category-review' },
    });
    expect(review.status).toBe(200);
    expect(review.data.unclassified.some((b) => b.slug === 'biz-review')).toBe(true);

    const set = await call(worker, env, 'POST', '/api/square/listings', {
      body: { pin: '0777', action: 'set-category', slug: 'biz-review', primary_category: 'community', subcategory: 'nonprofits' },
    });
    expect(set.status).toBe(200);

    const after = await call(worker, env, 'POST', '/api/square/listings', {
      body: { pin: '0777', action: 'category-review' },
    });
    expect(after.data.unclassified.some((b) => b.slug === 'biz-review')).toBe(false);
  });

  it('admin set-category enforces the same validation as owners get', async () => {
    const adminSalt = 'bb'.repeat(16);
    await env.DB.prepare('INSERT INTO businesses (slug, name, pin_hash, salt) VALUES (?,?,?,?)')
      .bind('titusville-square', 'titusville-square', hashPin('0777', adminSalt), adminSalt).run();
    await seedOwner(env, 'biz-adminbad');
    const res = await call(worker, env, 'POST', '/api/square/listings', {
      body: { pin: '0777', action: 'set-category', slug: 'biz-adminbad', primary_category: 'not-a-thing' },
    });
    expect(res.status).toBe(400);
  });
});
