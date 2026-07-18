import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../public/_worker.js';
import { hashPin } from '../../public/_worker.js';
import { createTestD1 } from '../test-utils/d1.js';
import { call } from '../test-utils/worker.js';

const SECRET = 'test-secret';

async function seedLegacyBusiness(env, slug, pin = '1234') {
  const salt = 'aa'.repeat(16);
  const pin_hash = hashPin(pin, salt);
  const r = await env.DB.prepare('INSERT INTO businesses (slug, name, pin_hash, salt) VALUES (?,?,?,?)')
    .bind(slug, slug, pin_hash, salt).run();
  return r.meta.last_row_id;
}

describe('login + OWNER auto-provisioning (existing single-PIN tenants)', () => {
  let env;
  beforeEach(() => {
    const { DB } = createTestD1();
    env = { DB, SESSION_SECRET: SECRET };
  });

  it("logs in a legacy tenant (no users row yet) with their unchanged PIN", async () => {
    await seedLegacyBusiness(env, 'warners-bakery', '1234');
    const { status, data } = await call(worker, env, 'POST', '/api/auth/login', { body: { slug: 'warners-bakery', pin: '1234' } });
    expect(status).toBe(200);
    expect(data.role).toBe('OWNER');
    expect(data.userId).toBeTypeOf('number');
  });

  it('auto-provisions exactly one OWNER row across repeat logins', async () => {
    await seedLegacyBusiness(env, 'warners-bakery', '1234');
    await call(worker, env, 'POST', '/api/auth/login', { body: { slug: 'warners-bakery', pin: '1234' } });
    await call(worker, env, 'POST', '/api/auth/login', { body: { slug: 'warners-bakery', pin: '1234' } });
    const owners = await env.DB.prepare("SELECT COUNT(*) as c FROM users WHERE role='OWNER'").first();
    expect(owners.c).toBe(1);
  });

  it('rejects an invalid PIN with a generic error', async () => {
    await seedLegacyBusiness(env, 'warners-bakery', '1234');
    const { status, data } = await call(worker, env, 'POST', '/api/auth/login', { body: { slug: 'warners-bakery', pin: '9999' } });
    expect(status).toBe(401);
    expect(data.error).toBe('invalid_login');
  });

  it('rejects a login for a slug that does not exist', async () => {
    const { status } = await call(worker, env, 'POST', '/api/auth/login', { body: { slug: 'no-such-business', pin: '1234' } });
    expect(status).toBe(401);
  });

  it('GET /api/session reflects role/userId for a v2 session', async () => {
    await seedLegacyBusiness(env, 'warners-bakery', '1234');
    const login = await call(worker, env, 'POST', '/api/auth/login', { body: { slug: 'warners-bakery', pin: '1234' } });
    const { status, data } = await call(worker, env, 'GET', '/api/session', { token: login.data.token });
    expect(status).toBe(200);
    expect(data.role).toBe('OWNER');
    expect(data.userId).toBe(login.data.userId);
  });

  it('logout clears the session cookie (endpoint itself just returns ok)', async () => {
    const { status, data } = await call(worker, env, 'POST', '/api/auth/logout');
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });
});

describe('shared-credential auto-provision guard', () => {
  let env;
  beforeEach(() => {
    const { DB } = createTestD1();
    env = { DB, SESSION_SECRET: SECRET };
  });

  async function seedSharedBusiness(env, slug, pin, salt) {
    const pin_hash = hashPin(pin, salt);
    const r = await env.DB.prepare('INSERT INTO businesses (slug, name, pin_hash, salt) VALUES (?,?,?,?)')
      .bind(slug, slug, pin_hash, salt).run();
    return r.meta.last_row_id;
  }

  it('refuses to auto-provision OWNER when the PIN hash/salt is shared across multiple businesses', async () => {
    const salt = 'bb'.repeat(16);
    await seedSharedBusiness(env, 'panel-biz-a', '4048', salt);
    await seedSharedBusiness(env, 'panel-biz-b', '4048', salt);

    const a = await call(worker, env, 'POST', '/api/auth/login', { body: { slug: 'panel-biz-a', pin: '4048' } });
    expect(a.status).toBe(403);
    expect(a.data.error).toBe('not_yet_claimed');

    const b = await call(worker, env, 'POST', '/api/auth/login', { body: { slug: 'panel-biz-b', pin: '4048' } });
    expect(b.status).toBe(403);
    expect(b.data.error).toBe('not_yet_claimed');

    const owners = await env.DB.prepare("SELECT COUNT(*) as c FROM users WHERE role='OWNER'").first();
    expect(owners.c).toBe(0);
  });

  it('still auto-provisions normally for a business with a unique PIN hash/salt', async () => {
    await seedSharedBusiness(env, 'real-business', '9999', 'cc'.repeat(16));
    const { status, data } = await call(worker, env, 'POST', '/api/auth/login', { body: { slug: 'real-business', pin: '9999' } });
    expect(status).toBe(200);
    expect(data.role).toBe('OWNER');
  });

  it('does not block a business that already has an active OWNER row, even if its hash is shared', async () => {
    const salt = 'dd'.repeat(16);
    await seedSharedBusiness(env, 'panel-biz-c', '4048', salt);
    await seedSharedBusiness(env, 'panel-biz-d', '4048', salt);
    // panel-biz-c gets manually claimed (a real OWNER row inserted directly, as the
    // Part A production pre-flight backfill does) — it should log in normally afterward,
    // even though its stored hash is still technically shared with panel-biz-d.
    const biz = await env.DB.prepare('SELECT id, pin_hash, salt FROM businesses WHERE slug=?').bind('panel-biz-c').first();
    await env.DB.prepare("INSERT INTO users (business_id, name, pin_hash, salt, role) VALUES (?,?,?,?,'OWNER')")
      .bind(biz.id, 'panel-biz-c', biz.pin_hash, biz.salt).run();

    const { status, data } = await call(worker, env, 'POST', '/api/auth/login', { body: { slug: 'panel-biz-c', pin: '4048' } });
    expect(status).toBe(200);
    expect(data.role).toBe('OWNER');
  });
});
