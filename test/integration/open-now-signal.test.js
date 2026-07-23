import { describe, it, expect, afterEach } from 'vitest';
import { vi } from 'vitest';
import worker from '../../public/_worker.js';
import { hashPin } from '../../public/_worker.js';
import { createTestD1 } from '../test-utils/d1.js';
import { call } from '../test-utils/worker.js';

const SECRET = 'test-secret';

// Drawbridge's own is_open switch defaults to 1 at signup and computes open_now from
// that switch + `hours`. A restaurant that never touched either still reports
// {open_now:true, hours:null} — this is what a just-approved, hours-untouched panel
// (e.g. the first real claimants, Fernwood Music / Soup Salad 'n Sammies) looked like,
// and it rendered as "Open now" around the clock with no schedule behind it.
function stubDrawbridge(hours) {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (String(url).includes('getdrawbridge.app/api/menu/')) {
      return new Response(JSON.stringify({ open_now: true, hours, specials: [] }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }));
}

async function seedDrawbridgeBiz(env, slug) {
  const salt = (slug + 'x'.repeat(32)).slice(0, 32);
  await env.DB.prepare(
    "INSERT INTO businesses (slug, name, pin_hash, salt, modules, is_public, subscription_status) VALUES (?,?,?,?,?,1,'comped')"
  ).bind(slug, slug, hashPin('1234', salt), salt, JSON.stringify({ drawbridge: true })).run();
}

describe('open-now signal trustworthiness', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('a business that never configured hours does NOT show as open (untouched default)', async () => {
    const { DB } = createTestD1();
    const env = { DB, SESSION_SECRET: SECRET };
    await seedDrawbridgeBiz(env, 'untouched-panel');
    stubDrawbridge(null); // hours: null — exactly the just-approved, never-touched case

    const res = await call(worker, env, 'GET', '/api/public/town?town=titusville');
    const biz = res.data.businesses.find((b) => b.slug === 'untouched-panel');
    expect(biz.live.open_now).not.toBe(true);
  });

  it('a business with real configured hours still gets its open_now honored', async () => {
    const { DB } = createTestD1();
    const env = { DB, SESSION_SECRET: SECRET };
    await seedDrawbridgeBiz(env, 'configured-panel');
    stubDrawbridge({ 1: [['08:00', '16:00']] }); // real hours on record

    const res = await call(worker, env, 'GET', '/api/public/town?town=titusville');
    const biz = res.data.businesses.find((b) => b.slug === 'configured-panel');
    expect(biz.live.open_now).toBe(true);
  });
});
