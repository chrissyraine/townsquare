import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import worker from '../../public/_worker.js';
import { hashPin } from '../../public/_worker.js';
import { createTestD1 } from '../test-utils/d1.js';
import { call } from '../test-utils/worker.js';
import { paypalEnv, stubPayPal, restorePayPal, TEST_PLAN_ID } from '../test-utils/paypal.js';

const SECRET = 'test-secret';
const MODULES = { drawbridge: true, herald: true };

// Seeds a business at a given subscription status. `status: null` is deliberate — it models a
// row created AFTER the migration that never paid, which must NOT be treated as active.
async function seedBiz(env, slug, status, modules = MODULES) {
  // Salt must be UNIQUE per business: identical pin_hash+salt across rows trips the
  // shared-credential guard in login, which refuses to auto-provision an OWNER.
  const salt = (slug + 'x'.repeat(32)).slice(0, 32);
  await env.DB.prepare(
    'INSERT INTO businesses (slug, name, pin_hash, salt, modules, is_public, subscription_status) VALUES (?,?,?,?,?,1,?)'
  ).bind(slug, slug, hashPin('1234', salt), salt, JSON.stringify(modules), status).run();
  const login = await call(worker, env, 'POST', '/api/auth/login', { body: { slug, pin: '1234' } });
  return login.data.token;
}

function townEntry(res, slug) {
  return (res.data.businesses || []).find((b) => b.slug === slug);
}

describe('subscription gating', () => {
  let env;
  beforeEach(() => {
    const { DB } = createTestD1();
    env = { DB, SESSION_SECRET: SECRET, ...paypalEnv() };
    stubPayPal();
  });
  afterEach(() => restorePayPal());

  // --- the regression that matters most: nobody who works today stops working ---

  it('grandfathered and comped businesses keep publishing their paid signals', async () => {
    await seedBiz(env, 'warners-bakery', 'grandfathered');
    await seedBiz(env, 'benson-memorial-library', 'comped');
    const dir = await call(worker, env, 'GET', '/api/public/directory?town=titusville');
    expect(townEntry(dir, 'warners-bakery').modules).toEqual(MODULES);
    expect(townEntry(dir, 'benson-memorial-library').modules).toEqual(MODULES);
  });

  it('grandfathered and comped owners can still write through the broker', async () => {
    for (const status of ['grandfathered', 'comped', 'active']) {
      const { DB } = createTestD1();
      const e = { DB, SESSION_SECRET: SECRET, HERALD_SECRET: 's', ...paypalEnv() };
      stubPayPal();
      const token = await seedBiz(e, 'biz-' + status, status);
      const res = await call(worker, e, 'POST', '/api/m/herald/api/thing', { token, body: {} });
      expect(res.status, `${status} must not be blocked`).not.toBe(402);
    }
  });

  // --- a lapse is read-only, never deletion ---

  it('a lapsed business stops publishing paid signals but stays in the directory', async () => {
    await seedBiz(env, 'lapsed-cafe', 'cancelled');
    const dir = await call(worker, env, 'GET', '/api/public/directory?town=titusville');
    const entry = townEntry(dir, 'lapsed-cafe');
    expect(entry, 'the listing itself must remain findable').toBeTruthy();
    expect(entry.name).toBe('lapsed-cafe');
    expect(entry.modules).toEqual({}); // paid signals withheld...
  });

  it('a lapse never touches the stored modules — the row is unchanged', async () => {
    await seedBiz(env, 'lapsed-cafe', 'cancelled');
    await call(worker, env, 'GET', '/api/public/directory?town=titusville');
    const row = await env.DB.prepare('SELECT modules FROM businesses WHERE slug=?').bind('lapsed-cafe').first();
    expect(JSON.parse(row.modules)).toEqual(MODULES); // ...but nothing was deleted
  });

  it('a lapsed owner can still READ their own data, but writes are refused with 402', async () => {
    const env2 = { ...env, HERALD_SECRET: 'secret' };
    const token = await seedBiz(env2, 'lapsed-cafe', 'past_due');

    const write = await call(worker, env2, 'POST', '/api/m/herald/api/thing', { token, body: {} });
    expect(write.status).toBe(402);
    expect(write.data.error).toBe('subscription_inactive');
    expect(write.data.subscription_status).toBe('past_due');

    const read = await call(worker, env2, 'GET', '/api/m/herald/api/thing', { token });
    expect(read.status, 'reads of their own data must stay available').not.toBe(402);
  });

  it('a lapsed owner still signs in, and is told the subscription is inactive', async () => {
    await seedBiz(env, 'lapsed-cafe', 'cancelled');
    const login = await call(worker, env, 'POST', '/api/auth/login', { body: { slug: 'lapsed-cafe', pin: '1234' } });
    expect(login.status).toBe(200);
    expect(login.data.token).toBeTruthy();
    expect(login.data.subscription_active).toBe(false);
    expect(login.data.subscription_status).toBe('cancelled');
  });

  // --- reactivation restores, without re-verifying ownership ---

  it('reactivating restores publishing without any admin review or email loop', async () => {
    const token = await seedBiz(env, 'lapsed-cafe', 'cancelled');

    const before = townEntry(await call(worker, env, 'GET', '/api/public/directory?town=titusville'), 'lapsed-cafe');
    expect(before.modules).toEqual({});

    const re = await call(worker, env, 'POST', '/api/owner/reactivate', { token, body: { subscriptionID: 'I-NEWSUB' } });
    expect(re.status).toBe(200);
    expect(re.data.subscription_status).toBe('active');

    const after = townEntry(await call(worker, env, 'GET', '/api/public/directory?town=titusville'), 'lapsed-cafe');
    expect(after.modules).toEqual(MODULES); // everything came back, exactly as it was
  });

  it('reactivation rejects a subscription already backing another business', async () => {
    await seedBiz(env, 'other-shop', 'active');
    await env.DB.prepare('UPDATE businesses SET subscription_id=? WHERE slug=?').bind('I-TAKEN', 'other-shop').run();
    const token = await seedBiz(env, 'lapsed-cafe', 'cancelled');
    const re = await call(worker, env, 'POST', '/api/owner/reactivate', { token, body: { subscriptionID: 'I-TAKEN' } });
    expect(re.status).toBe(409);
    expect(re.data.error).toBe('subscription_already_used');
  });

  it('reactivation rejects a subscription PayPal does not report as active', async () => {
    restorePayPal();
    stubPayPal({ status: 'CANCELLED' });
    const token = await seedBiz(env, 'lapsed-cafe', 'cancelled');
    const re = await call(worker, env, 'POST', '/api/owner/reactivate', { token, body: { subscriptionID: 'I-DEAD' } });
    expect(re.status).toBe(402);
  });

  it('reactivation rejects a subscription on the wrong plan', async () => {
    restorePayPal();
    stubPayPal({ planId: 'P-SOME-CHEAPER-PLAN' });
    const token = await seedBiz(env, 'lapsed-cafe', 'cancelled');
    const re = await call(worker, env, 'POST', '/api/owner/reactivate', { token, body: { subscriptionID: 'I-WRONG' } });
    expect(re.status).toBe(402);
    expect(re.data.error).toBe('plan_mismatch');
  });

  it('reactivation requires a session — a stranger cannot revive someone else', async () => {
    await seedBiz(env, 'lapsed-cafe', 'cancelled');
    const re = await call(worker, env, 'POST', '/api/owner/reactivate', { body: { subscriptionID: 'I-NEWSUB' } });
    expect(re.status).toBe(401);
  });

  it('uses the real Founding 50 plan, not a second one', async () => {
    const token = await seedBiz(env, 'lapsed-cafe', 'cancelled');
    await call(worker, env, 'POST', '/api/owner/reactivate', { token, body: { subscriptionID: 'I-NEWSUB' } });
    const row = await env.DB.prepare('SELECT subscription_plan_id FROM businesses WHERE slug=?').bind('lapsed-cafe').first();
    expect(row.subscription_plan_id).toBe(TEST_PLAN_ID);
  });
});
