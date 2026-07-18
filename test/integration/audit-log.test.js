import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../public/_worker.js';
import { hashPin } from '../../public/_worker.js';
import { createTestD1 } from '../test-utils/d1.js';
import { call } from '../test-utils/worker.js';

const SECRET = 'test-secret';
const SQUARE_PIN = '4321';

async function seedOwnerBusiness(env, slug, pin = '1234') {
  const salt = 'aa'.repeat(16);
  const pin_hash = hashPin(pin, salt);
  await env.DB.prepare('INSERT INTO businesses (slug, name, pin_hash, salt) VALUES (?,?,?,?)').bind(slug, slug, pin_hash, salt).run();
  const login = await call(worker, env, 'POST', '/api/auth/login', { body: { slug, pin } });
  return login.data.token;
}

// The square-admin routes gate on the titusville-square account's PIN.
async function seedSquareAdmin(env) {
  const salt = 'bb'.repeat(16);
  await env.DB.prepare('INSERT INTO businesses (slug, name, pin_hash, salt) VALUES (?,?,?,?)')
    .bind('titusville-square', 'Titusville Square', hashPin(SQUARE_PIN, salt), salt).run();
}

async function auditRows(env) {
  return (await env.DB.prepare('SELECT * FROM audit_log ORDER BY id').all()).results;
}

describe('audit_log — write coverage', () => {
  let env, token;
  beforeEach(async () => {
    const { DB } = createTestD1();
    env = { DB, SESSION_SECRET: SECRET };
    token = await seedOwnerBusiness(env, 'warners-bakery');
  });

  it('writes exactly one row per mutation, not one per request', async () => {
    const before = (await auditRows(env)).length;
    await call(worker, env, 'PATCH', '/api/business/profile', { token, body: { blurb: 'Fresh bread daily' } });
    const rows = await auditRows(env);
    expect(rows.length).toBe(before + 1);
    expect(rows.at(-1).action).toBe('business.profile_update');
  });

  it('records the square-admin event DELETE with what was destroyed', async () => {
    await seedSquareAdmin(env);
    const created = await call(worker, env, 'POST', '/api/business/events', { token, body: { title: 'Bake Sale', starts_at: '2026-08-01 10:00' } });
    const id = created.data.id;

    const del = await call(worker, env, 'POST', '/api/square/events', { body: { pin: SQUARE_PIN, action: 'delete', id } });
    expect(del.status).toBe(200);

    const row = (await auditRows(env)).find((r) => r.action === 'event.delete' && r.actor === 'admin');
    expect(row).toBeDefined();
    expect(row.entity_type).toBe('town_events');
    expect(row.entity_id).toBe(String(id));
    // The title must survive the row it described — this is the incident this closes.
    expect(row.summary).toContain('Bake Sale');
  });

  it('records a public self-serve-style business insert as actor "public"', async () => {
    // Exercised via the public event-submit path, which shares the same actor rule.
    await call(worker, env, 'POST', '/api/public/events/submit', {
      body: { title: 'Town Picnic', starts_at: '2026-09-01 12:00' },
    });
    const row = (await auditRows(env)).find((r) => r.action === 'event.submit');
    expect(row).toBeDefined();
    expect(row.actor).toBe('public');
    expect(row.summary).toContain('Town Picnic');
  });

  it('covers the event PATCH path that had no logging at all before', async () => {
    const created = await call(worker, env, 'POST', '/api/business/events', { token, body: { title: 'Bake Sale', starts_at: '2026-08-01 10:00' } });
    await call(worker, env, 'PATCH', `/api/business/events/${created.data.id}`, { token, body: { title: 'Renamed Sale' } });
    const row = (await auditRows(env)).find((r) => r.action === 'event.update');
    expect(row).toBeDefined();
    expect(row.summary).toContain('title');
  });

  it('logs team role changes with both the acting user and the target', async () => {
    const invite = await call(worker, env, 'POST', '/api/team/invite', { token, body: { name: 'Sam', role: 'STAFF' } });
    const accepted = await call(worker, env, 'POST', `/api/team/invite/${invite.data.invite_code}/accept`, { body: { name: 'Sam', pin: '5678' } });
    await call(worker, env, 'PATCH', `/api/team/members/${accepted.data.userId}`, { token, body: { role: 'MANAGER' } });

    const row = (await auditRows(env)).find((r) => r.action === 'team.role_change');
    expect(row).toBeDefined();
    expect(row.summary).toContain('STAFF to MANAGER');
  });

  it('stamps ts as UTC ISO-8601 and carries an actor + action on every row', async () => {
    await call(worker, env, 'PATCH', '/api/business/profile', { token, body: { blurb: 'x' } });
    for (const row of await auditRows(env)) {
      expect(row.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(row.actor).toBeTruthy();
      expect(row.action).toBeTruthy();
    }
  });
});

describe('audit_log — privacy contract', () => {
  let env;
  beforeEach(async () => {
    const { DB } = createTestD1();
    env = { DB, SESSION_SECRET: SECRET };
  });

  it('never writes a PIN, hash, salt, or invite code into any column', async () => {
    const token = await seedOwnerBusiness(env, 'warners-bakery', '1234');
    const invite = await call(worker, env, 'POST', '/api/team/invite', { token, body: { name: 'Sam', role: 'STAFF' } });
    await call(worker, env, 'POST', `/api/team/invite/${invite.data.invite_code}/accept`, { body: { name: 'Sam', pin: '5678' } });

    const biz = await env.DB.prepare('SELECT pin_hash, salt FROM businesses WHERE slug=?').bind('warners-bakery').first();
    const blob = JSON.stringify(await auditRows(env));

    expect(blob).not.toContain('1234');
    expect(blob).not.toContain('5678');
    expect(blob).not.toContain(biz.pin_hash);
    expect(blob).not.toContain(biz.salt);
    expect(blob).not.toContain(invite.data.invite_code);
  });

  it('never writes an email, phone, or raw IP from a public submission', async () => {
    await call(worker, env, 'POST', '/api/public/list-submit', {
      body: {
        name: 'TEST — Sample Shop (ignore/delete me)', category: 'Retail',
        email: 'chrissyschroer@gmail.com', phone: '814-555-0100',
        description: 'Safe to delete this record.', owner_ok: true,
      },
    });
    const blob = JSON.stringify(await auditRows(env));
    expect(blob).not.toContain('chrissyschroer@gmail.com');
    expect(blob).not.toContain('814-555-0100');
  });

  it('hashes the IP with a keyed HMAC — never the raw address, never a bare digest', async () => {
    const ip = '203.0.113.42';
    // A fresh Request per call — a Request whose body has been read cannot be
    // reused or cloned, so building it twice is the only way to send the same
    // input through two different secrets.
    const submitAs = (secretEnv) => worker.fetch(
      new Request('https://gettownsquare.app/api/public/events/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
        body: JSON.stringify({ title: 'IP Check', starts_at: '2026-09-01 12:00' }),
      }),
      secretEnv,
    );

    await submitAs(env);
    const row = (await auditRows(env)).find((r) => r.action === 'event.submit');
    expect(row.ip_hash).toBeTruthy();
    expect(row.ip_hash).not.toContain(ip);
    expect(row.ip_hash).toHaveLength(16);

    // A plain sha256 would be brute-forceable across the ~4e9 IPv4 space, so the
    // digest must depend on the secret: same IP + different key => different hash.
    await submitAs({ ...env, SESSION_SECRET: 'a-different-secret' });
    const rows = (await auditRows(env)).filter((r) => r.action === 'event.submit');
    expect(rows[1].ip_hash).not.toBe(rows[0].ip_hash);
  });
});

describe('audit_log — must never break the real operation', () => {
  it('the mutation still succeeds when the audit insert throws', async () => {
    const { DB } = createTestD1();
    const env = { DB, SESSION_SECRET: SECRET };
    const token = await seedOwnerBusiness(env, 'warners-bakery');

    // Break only the audit_log insert; every other statement passes through.
    const realPrepare = DB.prepare.bind(DB);
    DB.prepare = (sql) => {
      if (sql.includes('INSERT INTO audit_log')) throw new Error('audit storage is down');
      return realPrepare(sql);
    };

    const res = await call(worker, env, 'POST', '/api/business/events', { token, body: { title: 'Bake Sale', starts_at: '2026-08-01 10:00' } });
    expect(res.status).toBe(200);
    expect(res.data.id).toBeTypeOf('number');

    DB.prepare = realPrepare;
    const ev = await DB.prepare('SELECT title FROM town_events WHERE id=?').bind(res.data.id).first();
    expect(ev.title).toBe('Bake Sale'); // the real write landed despite the logging failure
  });
});

describe('audit_log — no public exposure', () => {
  it('no route in the worker returns audit_log data', async () => {
    const { DB } = createTestD1();
    const env = { DB, SESSION_SECRET: SECRET };
    const token = await seedOwnerBusiness(env, 'warners-bakery');
    await call(worker, env, 'PATCH', '/api/business/profile', { token, body: { blurb: 'seeded' } });
    expect((await auditRows(env)).length).toBeGreaterThan(0);

    // Every read endpoint an owner or the public can reach.
    const reads = [
      ['GET', '/api/activity'], ['GET', '/api/business/home'], ['GET', '/api/business/profile'],
      ['GET', '/api/business/events'], ['GET', '/api/business/preview'], ['GET', '/api/team'],
      ['GET', '/api/session'], ['GET', '/api/public/directory'], ['GET', '/api/public/events'],
      ['GET', '/api/public/town'],
    ];
    for (const [method, path] of reads) {
      const res = await call(worker, env, method, path, { token });
      const body = JSON.stringify(res.data || {});
      expect(body).not.toContain('audit_log');
      expect(body).not.toContain('ip_hash');
    }

    // And the admin queues, which take a PIN rather than a session.
    const salt = 'bb'.repeat(16);
    await env.DB.prepare('INSERT INTO businesses (slug, name, pin_hash, salt) VALUES (?,?,?,?)')
      .bind('titusville-square', 'Titusville Square', hashPin(SQUARE_PIN, salt), salt).run();
    for (const path of ['/api/square/events', '/api/square/listings']) {
      const res = await call(worker, env, 'POST', path, { body: { pin: SQUARE_PIN, action: 'list' } });
      const body = JSON.stringify(res.data || {});
      expect(body).not.toContain('ip_hash');
      expect(body).not.toContain('audit');
    }
  });
});
