import { vi } from 'vitest';

// The real Founding 50 plan (the claim flow reuses it; there is no second plan).
export const TEST_PLAN_ID = 'P-6YJ33771Y6287535FNJDLG4I';

// SAFETY: `verifyPayPalSubscription` falls back to the HARDCODED LIVE client id when
// PAYPAL_CLIENT_ID is unset, so a test that sets PAYPAL_SECRET without overriding the
// API base would hit real PayPal. Always spread this into a test env, and always
// stubPayPal() alongside it — the .invalid TLD can never resolve if a stub is missed.
export function paypalEnv(extra = {}) {
  return {
    PAYPAL_CLIENT_ID: 'test-client-id',
    PAYPAL_SECRET: 'test-client-secret',
    PAYPAL_API_BASE: 'https://paypal.invalid',
    ...extra,
  };
}

// Stubs global fetch with canned PayPal OAuth + subscription responses.
// Returns { calls } so a test can assert PayPal was (or wasn't) consulted — asserting
// on the absence of a call is what proves a gate short-circuited.
export function stubPayPal({
  status = 'ACTIVE',
  planId = TEST_PLAN_ID,
  subscriptionFound = true,
  authOk = true,
} = {}) {
  const calls = [];
  // `requests` also captures POST bodies. Asserting on a URL alone is not enough when
  // several different emails share one outbound pipe — the OTP send and the admin alert
  // both POST to MAILER_URL, so a URL-only assertion passes even when the alert is gone.
  const requests = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const u = String(url);
    calls.push(u);
    requests.push({ url: u, body: init && typeof init.body === 'string' ? init.body : '' });
    if (u.includes('/v1/oauth2/token')) {
      return new Response(JSON.stringify(authOk ? { access_token: 'test-token' } : { error: 'invalid_client' }),
        { status: authOk ? 200 : 401 });
    }
    if (u.includes('/v1/billing/subscriptions/')) {
      if (!subscriptionFound) return new Response(JSON.stringify({}), { status: 404 });
      return new Response(JSON.stringify({ id: u.split('/').pop(), status, plan_id: planId }), { status: 200 });
    }
    // Any other outbound call (Resend, product feeds) resolves harmlessly.
    return new Response('{}', { status: 200 });
  }));
  return { calls, requests };
}

export function restorePayPal() {
  vi.unstubAllGlobals();
}
