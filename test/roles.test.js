import { describe, it, expect, beforeEach } from 'vitest';
import { requireRole, signClassic, hashPin } from '../public/_worker.js';
import { createTestD1 } from './test-utils/d1.js';

const SECRET = 'test-secret';

function makeRequest(token) {
  return new Request('https://gettownsquare.app/api/whatever', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

async function seedBusiness(env, slug) {
  const salt = 'aa'.repeat(16);
  const pin_hash = hashPin('1234', salt);
  const r = await env.DB.prepare('INSERT INTO businesses (slug, name, pin_hash, salt) VALUES (?,?,?,?)')
    .bind(slug, slug, pin_hash, salt).run();
  return r.meta.last_row_id;
}

async function seedUser(env, businessId, role, isActive = 1) {
  const r = await env.DB.prepare(
    'INSERT INTO users (business_id, name, pin_hash, salt, role, is_active) VALUES (?,?,?,?,?,?)'
  ).bind(businessId, 'Test User', 'x', 'y', role, isActive).run();
  return r.meta.last_row_id;
}

function tokenFor(slug, uid, role) {
  return signClassic({ slug, exp: Date.now() + 60_000, uid, role }, SECRET);
}

describe('requireRole', () => {
  let env, bizAId, bizBId;

  beforeEach(async () => {
    const { DB } = createTestD1();
    env = { DB, SESSION_SECRET: SECRET };
    bizAId = await seedBusiness(env, 'business-a');
    bizBId = await seedBusiness(env, 'business-b');
  });

  it('allows an OWNER to reach an OWNER-gated action', async () => {
    const uid = await seedUser(env, bizAId, 'OWNER');
    const ctx = await requireRole(makeRequest(tokenFor('business-a', uid, 'OWNER')), env, 'OWNER');
    expect(ctx).toMatchObject({ userId: uid, businessId: bizAId, slug: 'business-a', role: 'OWNER' });
  });

  it('blocks a STAFF session from a MANAGER-gated action', async () => {
    const uid = await seedUser(env, bizAId, 'STAFF');
    const ctx = await requireRole(makeRequest(tokenFor('business-a', uid, 'STAFF')), env, 'MANAGER');
    expect(ctx).toBeNull();
  });

  it('blocks a MANAGER session from an OWNER-gated action', async () => {
    const uid = await seedUser(env, bizAId, 'MANAGER');
    const ctx = await requireRole(makeRequest(tokenFor('business-a', uid, 'MANAGER')), env, 'OWNER');
    expect(ctx).toBeNull();
  });

  it('allows a higher role to reach a lower-gated action (OWNER can do MANAGER things)', async () => {
    const uid = await seedUser(env, bizAId, 'OWNER');
    const ctx = await requireRole(makeRequest(tokenFor('business-a', uid, 'OWNER')), env, 'STAFF');
    expect(ctx).not.toBeNull();
  });

  it('rejects a cross-business tampered token (slug does not match the user\'s real business)', async () => {
    // A user that really belongs to business B, but the token claims business A's slug.
    const uid = await seedUser(env, bizBId, 'OWNER');
    const ctx = await requireRole(makeRequest(tokenFor('business-a', uid, 'OWNER')), env, 'STAFF');
    expect(ctx).toBeNull();
  });

  it('rejects a revoked (is_active=0) user even with an otherwise-valid token', async () => {
    const uid = await seedUser(env, bizAId, 'OWNER', 0);
    const ctx = await requireRole(makeRequest(tokenFor('business-a', uid, 'OWNER')), env, 'STAFF');
    expect(ctx).toBeNull();
  });

  it('rejects a legacy token missing uid cleanly (no throw)', async () => {
    const token = signClassic({ slug: 'business-a', exp: Date.now() + 60_000 }, SECRET);
    await expect(requireRole(makeRequest(token), env, 'STAFF')).resolves.toBeNull();
  });

  it('rejects when there is no session at all', async () => {
    const ctx = await requireRole(makeRequest(null), env, 'STAFF');
    expect(ctx).toBeNull();
  });

  it('rejects an unknown role string safely', async () => {
    const uid = await seedUser(env, bizAId, 'SUPERUSER'); // not a real role, shouldn't rank-check into a false positive
    const ctx = await requireRole(makeRequest(tokenFor('business-a', uid, 'SUPERUSER')), env, 'STAFF');
    expect(ctx).toBeNull();
  });
});
