import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Buffer } from 'node:buffer';
import worker from '../../public/_worker.js';
import { hashPin } from '../../public/_worker.js';
import { createTestD1 } from '../test-utils/d1.js';
import { call } from '../test-utils/worker.js';
import { paypalEnv, stubPayPal, restorePayPal } from '../test-utils/paypal.js';

const SECRET = 'test-secret';

async function seedBusiness(env, slug, pin = '4048', shared = true) {
  // Mirrors the real seeded PANEL pattern: a shared placeholder hash by default,
  // so claim-accept's "does it self-heal to a unique hash" behavior is genuinely tested.
  const salt = shared ? 'aa'.repeat(16) : Buffer.from(slug).toString('hex').padEnd(32, '0').slice(0, 32);
  const pin_hash = hashPin(pin, salt);
  const r = await env.DB.prepare('INSERT INTO businesses (slug, name, pin_hash, salt) VALUES (?,?,?,?)')
    .bind(slug, slug, pin_hash, salt).run();
  return r.meta.last_row_id;
}

// start -> verify -> PAY. A claim only reaches the admin review queue after the
// Founding 50 subscription is verified server-side, so every test that needs a
// reviewable claim must now go through payment too.
async function startAndVerify(env, slug, email = 'claimant@example.com', name = 'Casey Claimant') {
  const start = await call(worker, env, 'POST', '/api/public/claim-start', {
    body: { business_slug: slug, name, email, role: 'Owner' },
  });
  expect(start.status).toBe(200);
  const verify = await call(worker, env, 'POST', '/api/public/claim-verify', {
    body: { claim_id: start.data.claim_id, code: start.data.dev_code },
  });
  const pay = await call(worker, env, 'POST', '/api/public/claim-pay', {
    body: { claim_id: start.data.claim_id, subscriptionID: `I-SUB-${slug}` },
  });
  return { start, verify, pay };
}

describe('listing claim flow', () => {
  let env;
  beforeEach(() => {
    const { DB } = createTestD1();
    env = { DB, SESSION_SECRET: SECRET, OTP_DEV_ECHO: '1', ...paypalEnv() };
    stubPayPal();
  });
  afterEach(() => restorePayPal());

  it('happy path: start -> verify -> admin approve -> accept -> new PIN logs in as OWNER, old shared PIN no longer works', async () => {
    await seedBusiness(env, 'panel-a', '4048');
    // A second business sharing the same placeholder hash, to prove self-healing later.
    await seedBusiness(env, 'panel-b', '4048');

    const { start, verify, pay } = await startAndVerify(env, 'panel-a');
    expect(verify.status).toBe(200);
    // Email verification alone no longer reaches review — payment comes first.
    expect(verify.data.status).toBe('payment_required');
    expect(pay.status).toBe(200);
    expect(pay.data.status).toBe('pending_review');

    const list = await call(worker, env, 'POST', '/api/square/claims', { body: { pin: '4048', action: 'list' } });
    // NOTE: squareOk checks against a business literally slugged 'titusville-square' which
    // doesn't exist in this seed — so this specific admin call is expected to 401 here.
    // Seed it properly to actually exercise the admin path:
    expect(list.status).toBe(401);

    const adminSalt = 'bb'.repeat(16);
    await env.DB.prepare('INSERT INTO businesses (slug, name, pin_hash, salt) VALUES (?,?,?,?)')
      .bind('titusville-square', 'titusville-square', hashPin('0777', adminSalt), adminSalt).run();

    const list2 = await call(worker, env, 'POST', '/api/square/claims', { body: { pin: '0777', action: 'list' } });
    expect(list2.status).toBe(200);
    expect(list2.data.claims.length).toBe(1);
    expect(list2.data.claims[0].status).toBe('pending_review');
    const claimId = list2.data.claims[0].id;

    const approve = await call(worker, env, 'POST', '/api/square/claims', { body: { pin: '0777', action: 'approve', id: claimId } });
    expect(approve.status).toBe(200);

    // Pull the accept_code directly from the DB (never exposed via any read endpoint).
    const row = await env.DB.prepare('SELECT accept_code FROM listing_claims WHERE id=?').bind(claimId).first();
    expect(row.accept_code).toBeTruthy();

    const resolve = await call(worker, env, 'GET', `/api/claim/${row.accept_code}`);
    expect(resolve.status).toBe(200);
    expect(resolve.data.business_name).toBe('panel-a');

    const accept = await call(worker, env, 'POST', `/api/claim/${row.accept_code}/accept`, { body: { pin: '9911' } });
    expect(accept.status).toBe(200);
    expect(accept.data.role).toBe('OWNER');

    // New PIN logs in as OWNER.
    const newLogin = await call(worker, env, 'POST', '/api/auth/login', { body: { slug: 'panel-a', pin: '9911' } });
    expect(newLogin.status).toBe(200);
    expect(newLogin.data.role).toBe('OWNER');

    // Old shared placeholder PIN no longer works for the claimed business.
    const oldLogin = await call(worker, env, 'POST', '/api/auth/login', { body: { slug: 'panel-a', pin: '4048' } });
    expect(oldLogin.status).toBe(401); // no users row matches it, and the legacy fallback hash was overwritten

    // panel-b (never claimed) still shares a hash with nothing else now — self-healed.
    const shared = await env.DB.prepare(
      "SELECT pin_hash, salt FROM businesses WHERE slug='panel-b'"
    ).first();
    const count = await env.DB.prepare('SELECT COUNT(*) as c FROM businesses WHERE pin_hash=? AND salt=?')
      .bind(shared.pin_hash, shared.salt).first();
    expect(count.c).toBe(1);

    void start;
  });

  it('reject path: business returns to unclaimed and is re-claimable', async () => {
    await seedBusiness(env, 'panel-c', '4048');
    const adminSalt = 'cc'.repeat(16);
    await env.DB.prepare('INSERT INTO businesses (slug, name, pin_hash, salt) VALUES (?,?,?,?)')
      .bind('titusville-square', 'titusville-square', hashPin('0777', adminSalt), adminSalt).run();

    await startAndVerify(env, 'panel-c');
    const list = await call(worker, env, 'POST', '/api/square/claims', { body: { pin: '0777', action: 'list' } });
    const claimId = list.data.claims[0].id;

    const reject = await call(worker, env, 'POST', '/api/square/claims', { body: { pin: '0777', action: 'reject', id: claimId, reason: 'Could not verify' } });
    expect(reject.status).toBe(200);

    const biz = await env.DB.prepare("SELECT claim_status FROM businesses WHERE slug='panel-c'").first();
    expect(biz.claim_status).toBe('unclaimed');

    // Re-claimable: a fresh claim-start on the same business now succeeds (no claim_in_progress).
    const retry = await call(worker, env, 'POST', '/api/public/claim-start', {
      body: { business_slug: 'panel-c', name: 'Someone Else', email: 'other@example.com', role: 'Owner' },
    });
    expect(retry.status).toBe(200);
  });

  it('expired OTP is rejected', async () => {
    await seedBusiness(env, 'panel-d', '4048');
    const start = await call(worker, env, 'POST', '/api/public/claim-start', {
      body: { business_slug: 'panel-d', name: 'Casey', email: 'casey@example.com' },
    });
    // The real code stores expires_at as an ISO string (new Date(...).toISOString()) —
    // match that format exactly here, not SQLite's own datetime() format, which Node's
    // Date parser treats as local time rather than UTC and would silently pass.
    await env.DB.prepare('UPDATE claim_otp_codes SET expires_at=? WHERE claim_id=?')
      .bind(new Date(Date.now() - 3600 * 1000).toISOString(), start.data.claim_id).run();
    const verify = await call(worker, env, 'POST', '/api/public/claim-verify', {
      body: { claim_id: start.data.claim_id, code: start.data.dev_code },
    });
    expect(verify.status).toBe(400);
    expect(verify.data.error).toBe('expired_code');
  });

  it('locks out after 5 wrong codes, even the correct one after that', async () => {
    await seedBusiness(env, 'panel-e', '4048');
    const start = await call(worker, env, 'POST', '/api/public/claim-start', {
      body: { business_slug: 'panel-e', name: 'Casey', email: 'casey@example.com' },
    });
    for (let i = 0; i < 5; i++) {
      const wrong = await call(worker, env, 'POST', '/api/public/claim-verify', {
        body: { claim_id: start.data.claim_id, code: '000000' },
      });
      expect(wrong.status).toBe(400);
    }
    const locked = await call(worker, env, 'POST', '/api/public/claim-verify', {
      body: { claim_id: start.data.claim_id, code: start.data.dev_code },
    });
    expect(locked.status).toBe(429);
    expect(locked.data.error).toBe('too_many_attempts');
  });

  it('blocks a second claim from a different email while one is in flight', async () => {
    await seedBusiness(env, 'panel-f', '4048');
    await call(worker, env, 'POST', '/api/public/claim-start', {
      body: { business_slug: 'panel-f', name: 'First Claimant', email: 'first@example.com' },
    });
    const second = await call(worker, env, 'POST', '/api/public/claim-start', {
      body: { business_slug: 'panel-f', name: 'Second Claimant', email: 'second@example.com' },
    });
    expect(second.status).toBe(409);
    expect(second.data.error).toBe('claim_in_progress');
  });

  it('collapses a same-email resubmission into a resend on the same claim_id', async () => {
    await seedBusiness(env, 'panel-g', '4048');
    const first = await call(worker, env, 'POST', '/api/public/claim-start', {
      body: { business_slug: 'panel-g', name: 'Casey', email: 'casey@example.com' },
    });
    const second = await call(worker, env, 'POST', '/api/public/claim-start', {
      body: { business_slug: 'panel-g', name: 'Casey', email: 'casey@example.com' },
    });
    expect(second.status).toBe(200);
    expect(second.data.claim_id).toBe(first.data.claim_id);
  });

  it('business isolation: claiming business A never touches business B', async () => {
    await seedBusiness(env, 'iso-a', '1111', false);
    await seedBusiness(env, 'iso-b', '2222', false);
    const adminSalt = 'dd'.repeat(16);
    await env.DB.prepare('INSERT INTO businesses (slug, name, pin_hash, salt) VALUES (?,?,?,?)')
      .bind('titusville-square', 'titusville-square', hashPin('0777', adminSalt), adminSalt).run();

    await startAndVerify(env, 'iso-a');
    const list = await call(worker, env, 'POST', '/api/square/claims', { body: { pin: '0777', action: 'list' } });
    const claimId = list.data.claims.find((c) => c.business_slug === 'iso-a').id;
    await call(worker, env, 'POST', '/api/square/claims', { body: { pin: '0777', action: 'approve', id: claimId } });
    const row = await env.DB.prepare('SELECT accept_code FROM listing_claims WHERE id=?').bind(claimId).first();
    await call(worker, env, 'POST', `/api/claim/${row.accept_code}/accept`, { body: { pin: '9911' } });

    const bBefore = await env.DB.prepare("SELECT pin_hash, salt, claim_status FROM businesses WHERE slug='iso-b'").first();
    // iso-b was never touched by claiming iso-a.
    expect(bBefore.claim_status).toBe('unclaimed');
    const originalHash = hashPin('2222', Buffer.from('iso-b').toString('hex').padEnd(32, '0').slice(0, 32));
    expect(bBefore.pin_hash).toBe(originalHash);
  });

  it('an approved accept_code for one claim cannot be reused after redemption', async () => {
    await seedBusiness(env, 'panel-h', '4048');
    const adminSalt = 'ee'.repeat(16);
    await env.DB.prepare('INSERT INTO businesses (slug, name, pin_hash, salt) VALUES (?,?,?,?)')
      .bind('titusville-square', 'titusville-square', hashPin('0777', adminSalt), adminSalt).run();
    await startAndVerify(env, 'panel-h');
    const list = await call(worker, env, 'POST', '/api/square/claims', { body: { pin: '0777', action: 'list' } });
    const claimId = list.data.claims[0].id;
    await call(worker, env, 'POST', '/api/square/claims', { body: { pin: '0777', action: 'approve', id: claimId } });
    const row = await env.DB.prepare('SELECT accept_code FROM listing_claims WHERE id=?').bind(claimId).first();

    const first = await call(worker, env, 'POST', `/api/claim/${row.accept_code}/accept`, { body: { pin: '9911' } });
    expect(first.status).toBe(200);
    const second = await call(worker, env, 'POST', `/api/claim/${row.accept_code}/accept`, { body: { pin: '8822' } });
    expect(second.status).toBe(404);
    expect(second.data.error).toBe('invalid_or_expired_claim');
  });

  it('revoking an already-redeemed claim deactivates the access it granted', async () => {
    await seedBusiness(env, 'panel-i', '4048');
    const adminSalt = 'ff'.repeat(16);
    await env.DB.prepare('INSERT INTO businesses (slug, name, pin_hash, salt) VALUES (?,?,?,?)')
      .bind('titusville-square', 'titusville-square', hashPin('0777', adminSalt), adminSalt).run();
    await startAndVerify(env, 'panel-i');
    const list = await call(worker, env, 'POST', '/api/square/claims', { body: { pin: '0777', action: 'list' } });
    const claimId = list.data.claims[0].id;
    await call(worker, env, 'POST', '/api/square/claims', { body: { pin: '0777', action: 'approve', id: claimId } });
    const row = await env.DB.prepare('SELECT accept_code FROM listing_claims WHERE id=?').bind(claimId).first();
    await call(worker, env, 'POST', `/api/claim/${row.accept_code}/accept`, { body: { pin: '9911' } });

    await call(worker, env, 'POST', '/api/square/claims', { body: { pin: '0777', action: 'revoke', id: claimId } });

    const login = await call(worker, env, 'POST', '/api/auth/login', { body: { slug: 'panel-i', pin: '9911' } });
    expect(login.status).toBe(401);
  });

  it('no claim response ever includes a raw OTP hash or accept_code outside its own resolve step', async () => {
    await seedBusiness(env, 'panel-j', '4048');
    const start = await call(worker, env, 'POST', '/api/public/claim-start', {
      body: { business_slug: 'panel-j', name: 'Casey', email: 'casey@example.com' },
    });
    const serialized = JSON.stringify(start.data);
    expect(serialized).not.toMatch(/code_hash/);
    // dev_code is deliberately present here (OTP_DEV_ECHO), but never in a non-dev response shape.
    const verify = await call(worker, env, 'POST', '/api/public/claim-verify', {
      body: { claim_id: start.data.claim_id, code: start.data.dev_code },
    });
    expect(JSON.stringify(verify.data)).not.toMatch(/code_hash|accept_code/);
  });

  // Regression: the pay step was added between verify and review, and the alert moved with
  // it — so a claimant who verified and then stalled at payment was completely invisible.
  // That is exactly how the first real claim was missed. Alert on verify, not just on pay.
  it('alerts Chrissy as soon as the email is verified, BEFORE any payment', async () => {
    await seedBusiness(env, 'panel-notify', '4048');
    const mailerEnv = { ...env, MAILER_URL: 'https://mailer.invalid/send', MAILER_SECRET: 'm-secret' };
    const { requests } = stubPayPal();

    const start = await call(worker, mailerEnv, 'POST', '/api/public/claim-start', {
      body: { business_slug: 'panel-notify', name: 'Patrick', email: 'patrick@example.com', role: 'Owner' },
    });
    await call(worker, mailerEnv, 'POST', '/api/public/claim-verify', {
      body: { claim_id: start.data.claim_id, code: start.data.dev_code },
    });

    // No payment has happened yet — the alert must already have gone out.
    // Assert on the ALERT itself, not merely that the mailer pipe was touched — the OTP
    // email also POSTs there, and matched a URL-only assertion even with the alert removed.
    const alert = requests.find((r) => r.body.includes('Listing claim started (unpaid)'));
    expect(alert, 'no unpaid-claim alert was sent').toBeTruthy();
    expect(alert.body).toContain('patrick@example.com');
  });

});
