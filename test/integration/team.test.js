import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../public/_worker.js';
import { hashPin } from '../../public/_worker.js';
import { createTestD1 } from '../test-utils/d1.js';
import { call } from '../test-utils/worker.js';

const SECRET = 'test-secret';

async function seedOwner(env, slug, pin = '1234') {
  const salt = 'aa'.repeat(16);
  const pin_hash = hashPin(pin, salt);
  await env.DB.prepare('INSERT INTO businesses (slug, name, pin_hash, salt) VALUES (?,?,?,?)').bind(slug, slug, pin_hash, salt).run();
  const login = await call(worker, env, 'POST', '/api/auth/login', { body: { slug, pin } });
  return login.data.token;
}

describe('team invitations + role enforcement', () => {
  let env;
  beforeEach(() => {
    const { DB } = createTestD1();
    env = { DB, SESSION_SECRET: SECRET };
  });

  it('an OWNER can invite a teammate who accepts and gets their own independent login', async () => {
    const ownerToken = await seedOwner(env, 'warners-bakery');

    const invite = await call(worker, env, 'POST', '/api/team/invite', { token: ownerToken, body: { name: 'Sam', role: 'STAFF' } });
    expect(invite.status).toBe(200);

    const resolved = await call(worker, env, 'GET', `/api/team/invite/${invite.data.invite_code}`);
    expect(resolved.status).toBe(200);
    expect(resolved.data.role).toBe('STAFF');

    const accepted = await call(worker, env, 'POST', `/api/team/invite/${invite.data.invite_code}/accept`, { body: { name: 'Sam', pin: '5678' } });
    expect(accepted.status).toBe(200);
    expect(accepted.data.role).toBe('STAFF');

    const samLogin = await call(worker, env, 'POST', '/api/auth/login', { body: { slug: 'warners-bakery', pin: '5678' } });
    expect(samLogin.status).toBe(200);
    expect(samLogin.data.role).toBe('STAFF');
    expect(samLogin.data.userId).toBe(accepted.data.userId); // same accepted user, logging in independently
  });

  it('an expired/unknown invite code cannot be accepted', async () => {
    const accepted = await call(worker, env, 'POST', '/api/team/invite/not-a-real-code/accept', { body: { name: 'X', pin: '1111' } });
    expect(accepted.status).toBe(404);
  });

  it('a MANAGER cannot invite a teammate (OWNER-only)', async () => {
    const ownerToken = await seedOwner(env, 'warners-bakery');
    const invite = await call(worker, env, 'POST', '/api/team/invite', { token: ownerToken, body: { name: 'Manager', role: 'MANAGER' } });
    await call(worker, env, 'POST', `/api/team/invite/${invite.data.invite_code}/accept`, { body: { name: 'Manager', pin: '1111' } });
    const managerLogin = await call(worker, env, 'POST', '/api/auth/login', { body: { slug: 'warners-bakery', pin: '1111' } });

    const secondInvite = await call(worker, env, 'POST', '/api/team/invite', { token: managerLogin.data.token, body: { name: 'X', role: 'STAFF' } });
    expect(secondInvite.status).toBe(403);
  });

  it('a STAFF token cannot reach team management endpoints at all', async () => {
    const ownerToken = await seedOwner(env, 'warners-bakery');
    const invite = await call(worker, env, 'POST', '/api/team/invite', { token: ownerToken, body: { name: 'Staffer', role: 'STAFF' } });
    await call(worker, env, 'POST', `/api/team/invite/${invite.data.invite_code}/accept`, { body: { name: 'Staffer', pin: '2222' } });
    const staffLogin = await call(worker, env, 'POST', '/api/auth/login', { body: { slug: 'warners-bakery', pin: '2222' } });

    const teamList = await call(worker, env, 'GET', '/api/team', { token: staffLogin.data.token });
    expect(teamList.status).toBe(403);
  });

  it('an invite cannot mint an OWNER — only MANAGER/STAFF are grantable via invite', async () => {
    const ownerToken = await seedOwner(env, 'warners-bakery');
    const invite = await call(worker, env, 'POST', '/api/team/invite', { token: ownerToken, body: { name: 'X', role: 'OWNER' } });
    expect(invite.data.invite_code).toBeTruthy();
    const resolved = await call(worker, env, 'GET', `/api/team/invite/${invite.data.invite_code}`);
    expect(resolved.data.role).toBe('STAFF'); // 'OWNER' request silently falls back to STAFF
  });

  it('a duplicate PIN within the same business is rejected at accept time', async () => {
    const ownerToken = await seedOwner(env, 'warners-bakery', '1234');
    const invite = await call(worker, env, 'POST', '/api/team/invite', { token: ownerToken, body: { name: 'Dup', role: 'STAFF' } });
    const accept = await call(worker, env, 'POST', `/api/team/invite/${invite.data.invite_code}/accept`, { body: { name: 'Dup', pin: '1234' } });
    expect(accept.status).toBe(400);
  });

  it('the last remaining owner cannot be removed or demoted', async () => {
    const ownerToken = await seedOwner(env, 'warners-bakery');
    const session = await call(worker, env, 'GET', '/api/session', { token: ownerToken });
    const ownerId = session.data.userId;

    const del = await call(worker, env, 'DELETE', `/api/team/members/${ownerId}`, { token: ownerToken });
    expect(del.status).toBe(400);
    expect(del.data.error).toBe('cannot_remove_last_owner');

    const demote = await call(worker, env, 'PATCH', `/api/team/members/${ownerId}`, { token: ownerToken, body: { role: 'MANAGER' } });
    expect(demote.status).toBe(400);
  });

  it('a second owner CAN be removed once one remains', async () => {
    const ownerToken = await seedOwner(env, 'warners-bakery');
    const invite = await call(worker, env, 'POST', '/api/team/invite', { token: ownerToken, body: { name: 'Co-owner', role: 'MANAGER' } });
    await call(worker, env, 'POST', `/api/team/invite/${invite.data.invite_code}/accept`, { body: { name: 'Co-owner', pin: '3333' } });
    const coManagerLogin = await call(worker, env, 'POST', '/api/auth/login', { body: { slug: 'warners-bakery', pin: '3333' } });

    // Promote the manager to a second OWNER, then the original owner can safely step down.
    const promote = await call(worker, env, 'PATCH', `/api/team/members/${coManagerLogin.data.userId}`, { token: ownerToken, body: { role: 'OWNER' } });
    expect(promote.status).toBe(200);

    const session = await call(worker, env, 'GET', '/api/session', { token: ownerToken });
    const demote = await call(worker, env, 'PATCH', `/api/team/members/${session.data.userId}`, { token: ownerToken, body: { role: 'MANAGER' } });
    expect(demote.status).toBe(200);
  });
});
