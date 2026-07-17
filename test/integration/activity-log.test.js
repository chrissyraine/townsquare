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

describe('activity log', () => {
  let env, token;
  beforeEach(async () => {
    const { DB } = createTestD1();
    env = { DB, SESSION_SECRET: SECRET };
    token = await seedOwnerBusiness(env, 'warners-bakery');
  });

  it('logs a row on login', async () => {
    const activity = await call(worker, env, 'GET', '/api/activity', { token });
    expect(activity.data.activity.some((a) => a.type === 'login')).toBe(true);
  });

  it('logs exactly one row per profile update', async () => {
    await call(worker, env, 'PATCH', '/api/business/profile', { token, body: { blurb: 'Fresh bread daily' } });
    const activity = await call(worker, env, 'GET', '/api/activity', { token });
    expect(activity.data.activity.filter((a) => a.type === 'profile_updated').length).toBe(1);
  });

  it('logs event_created, event_published, and event_canceled distinctly', async () => {
    const created = await call(worker, env, 'POST', '/api/business/events', { token, body: { title: 'Bake Sale', starts_at: '2026-08-01 10:00' } });
    await call(worker, env, 'POST', `/api/business/events/${created.data.id}/publish`, { token });
    await call(worker, env, 'POST', `/api/business/events/${created.data.id}/cancel`, { token });

    const activity = await call(worker, env, 'GET', '/api/activity', { token });
    const types = activity.data.activity.map((a) => a.type);
    expect(types).toEqual(expect.arrayContaining(['event_created', 'event_published', 'event_canceled']));
  });

  it('logs team_invited when an invite is created', async () => {
    await call(worker, env, 'POST', '/api/team/invite', { token, body: { name: 'Sam', role: 'STAFF' } });
    const activity = await call(worker, env, 'GET', '/api/activity', { token });
    expect(activity.data.activity.some((a) => a.type === 'team_invited')).toBe(true);
  });

  it('respects the limit query parameter', async () => {
    for (let i = 0; i < 5; i++) {
      await call(worker, env, 'PATCH', '/api/business/profile', { token, body: { blurb: `update ${i}` } });
    }
    const activity = await call(worker, env, 'GET', '/api/activity?limit=2', { token });
    expect(activity.data.activity.length).toBe(2);
  });
});
