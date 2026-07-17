import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../public/_worker.js';
import { hashPin } from '../../public/_worker.js';
import { createTestD1 } from '../test-utils/d1.js';
import { call } from '../test-utils/worker.js';

const SECRET = 'test-secret';

async function seedOwnerBusiness(env, slug, pin = '1234', modules) {
  const salt = 'aa'.repeat(16);
  const pin_hash = hashPin(pin, salt);
  await env.DB.prepare('INSERT INTO businesses (slug, name, pin_hash, salt, modules) VALUES (?,?,?,?,?)')
    .bind(slug, slug, pin_hash, salt, JSON.stringify(modules || {})).run();
  const login = await call(worker, env, 'POST', '/api/auth/login', { body: { slug, pin } });
  return login.data.token;
}

describe('owner-facing event lifecycle', () => {
  let env, token;
  beforeEach(async () => {
    const { DB } = createTestD1();
    env = { DB, SESSION_SECRET: SECRET };
    token = await seedOwnerBusiness(env, 'warners-bakery');
  });

  it('creates a draft, publishes it, then cancels it — canceled events stay visible, badged', async () => {
    const created = await call(worker, env, 'POST', '/api/business/events', { token, body: { title: 'Bake Sale', starts_at: '2026-08-01 10:00' } });
    expect(created.status).toBe(200);
    expect(created.data.id).toBeTypeOf('number');

    const draft = (await call(worker, env, 'GET', '/api/business/events', { token })).data.events[0];
    expect(draft.is_published).toBe(0);

    expect((await call(worker, env, 'POST', `/api/business/events/${created.data.id}/publish`, { token })).status).toBe(200);
    expect((await call(worker, env, 'POST', `/api/business/events/${created.data.id}/cancel`, { token })).status).toBe(200);

    const after = (await call(worker, env, 'GET', '/api/business/events', { token })).data.events[0];
    expect(after.is_published).toBe(1);
    expect(after.is_canceled).toBe(1); // still present in the list — never silently removed
  });

  it('requires a title and a valid starts_at', async () => {
    const bad = await call(worker, env, 'POST', '/api/business/events', { token, body: { title: '', starts_at: 'not-a-date' } });
    expect(bad.status).toBe(400);
  });

  it('cannot hard-delete a published event — must cancel instead', async () => {
    const created = await call(worker, env, 'POST', '/api/business/events', { token, body: { title: 'Bake Sale', starts_at: '2026-08-01 10:00' } });
    await call(worker, env, 'POST', `/api/business/events/${created.data.id}/publish`, { token });
    const del = await call(worker, env, 'DELETE', `/api/business/events/${created.data.id}`, { token });
    expect(del.status).toBe(400);
    expect(del.data.error).toBe('cannot_delete_published');
  });

  it('can delete an unpublished draft', async () => {
    const created = await call(worker, env, 'POST', '/api/business/events', { token, body: { title: 'Draft only', starts_at: '2026-08-01 10:00' } });
    const del = await call(worker, env, 'DELETE', `/api/business/events/${created.data.id}`, { token });
    expect(del.status).toBe(200);
  });

  it('a business flagged to require moderation cannot self-publish', async () => {
    const modToken = await seedOwnerBusiness(env, 'moderated-biz', '4321', { moderate_events: true });
    const created = await call(worker, env, 'POST', '/api/business/events', { token: modToken, body: { title: 'Needs approval', starts_at: '2026-08-01 10:00' } });
    const publish = await call(worker, env, 'POST', `/api/business/events/${created.data.id}/publish`, { token: modToken });
    expect(publish.status).toBe(403);
    expect(publish.data.error).toBe('moderation_required');
  });

  it('a STAFF session cannot create events (MANAGER+ only)', async () => {
    const ownerToken = await seedOwnerBusiness(env, 'staffed-biz', '5555');
    const invite = await call(worker, env, 'POST', '/api/team/invite', { token: ownerToken, body: { name: 'Staffer', role: 'STAFF' } });
    await call(worker, env, 'POST', `/api/team/invite/${invite.data.invite_code}/accept`, { body: { name: 'Staffer', pin: '6666' } });
    const staffLogin = await call(worker, env, 'POST', '/api/auth/login', { body: { slug: 'staffed-biz', pin: '6666' } });

    const attempt = await call(worker, env, 'POST', '/api/business/events', { token: staffLogin.data.token, body: { title: 'Nope', starts_at: '2026-08-01 10:00' } });
    expect(attempt.status).toBe(403);
  });
});
