import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../public/_worker.js';
import { hashPin } from '../../public/_worker.js';
import { createTestD1 } from '../test-utils/d1.js';
import { call } from '../test-utils/worker.js';

const SECRET = 'test-secret';

async function seedOwnerBusiness(env, slug, pin = '1234') {
  const salt = 'aa'.repeat(16);
  const pin_hash = hashPin(pin, salt);
  await env.DB.prepare('INSERT INTO businesses (slug, name, pin_hash, salt) VALUES (?,?,?,?)').bind(slug, slug, pin_hash, salt).run();
  const login = await call(worker, env, 'POST', '/api/auth/login', { body: { slug, pin } });
  return login.data.token;
}

describe('cross-business isolation', () => {
  let env, tokenA, tokenB;
  beforeEach(async () => {
    const { DB } = createTestD1();
    env = { DB, SESSION_SECRET: SECRET };
    tokenA = await seedOwnerBusiness(env, 'business-a');
    tokenB = await seedOwnerBusiness(env, 'business-b');
  });

  it("a business's own profile GET never reflects another business's data", async () => {
    await call(worker, env, 'PATCH', '/api/business/profile', { token: tokenB, body: { blurb: 'B only' } });
    const asA = await call(worker, env, 'GET', '/api/business/profile', { token: tokenA });
    expect(asA.data.blurb).not.toBe('B only');
  });

  it("business A cannot edit an event that belongs to business B", async () => {
    const created = await call(worker, env, 'POST', '/api/business/events', { token: tokenB, body: { title: 'B event', starts_at: '2026-08-01 18:00' } });
    const edit = await call(worker, env, 'PATCH', `/api/business/events/${created.data.id}`, { token: tokenA, body: { title: 'hijacked' } });
    expect(edit.status).toBe(404);
  });

  it("business A cannot publish, cancel, or delete business B's event", async () => {
    const created = await call(worker, env, 'POST', '/api/business/events', { token: tokenB, body: { title: 'B event', starts_at: '2026-08-01 18:00' } });
    const id = created.data.id;
    expect((await call(worker, env, 'POST', `/api/business/events/${id}/publish`, { token: tokenA })).status).toBe(404);
    expect((await call(worker, env, 'POST', `/api/business/events/${id}/cancel`, { token: tokenA })).status).toBe(404);
    expect((await call(worker, env, 'DELETE', `/api/business/events/${id}`, { token: tokenA })).status).toBe(404);
  });

  it("business A's event list never includes business B's events", async () => {
    await call(worker, env, 'POST', '/api/business/events', { token: tokenB, body: { title: 'B event', starts_at: '2026-08-01 18:00' } });
    const listA = await call(worker, env, 'GET', '/api/business/events', { token: tokenA });
    expect(listA.data.events.length).toBe(0);
  });

  it("business A's activity log never includes business B's rows", async () => {
    await call(worker, env, 'PATCH', '/api/business/profile', { token: tokenB, body: { blurb: 'B activity' } });
    const activityA = await call(worker, env, 'GET', '/api/activity', { token: tokenA });
    // A has only its own login event so far — B's profile update must not appear here.
    expect(activityA.data.activity.some((a) => a.type === 'profile_updated')).toBe(false);
  });

  it("business A's team list never includes business B's members", async () => {
    const inviteB = await call(worker, env, 'POST', '/api/team/invite', { token: tokenB, body: { name: 'B-only-member', role: 'STAFF' } });
    await call(worker, env, 'POST', `/api/team/invite/${inviteB.data.invite_code}/accept`, { body: { name: 'B-only-member', pin: '9012' } });
    const teamA = await call(worker, env, 'GET', '/api/team', { token: tokenA });
    expect(teamA.data.members.some((m) => m.name === 'B-only-member')).toBe(false);
  });
});
