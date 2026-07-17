import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';
import { hashPin, verifyPin, hashPinStatic, signClassic, verifyClassic } from '../public/_worker.js';

describe('PIN hashing (per-account random salt)', () => {
  it('round-trips a correct PIN', () => {
    const salt = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
    const hash = hashPin('1234', salt);
    expect(verifyPin('1234', salt, hash)).toBe(true);
  });

  it('rejects a wrong PIN', () => {
    const salt = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
    const hash = hashPin('1234', salt);
    expect(verifyPin('9999', salt, hash)).toBe(false);
  });

  it('rejects when salt or hash is missing', () => {
    expect(verifyPin('1234', null, 'abc')).toBe(false);
    expect(verifyPin('1234', 'abc', null)).toBe(false);
  });

  it('the same PIN produces different hashes under different salts (no static rainbow-table shortcut)', () => {
    const h1 = hashPin('1234', 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4');
    const h2 = hashPin('1234', 'ffffffffffffffffffffffffffffffff');
    expect(h1).not.toBe(h2);
  });

  it('hashPinStatic matches the products\' fixed zero-salt scheme, distinct from a random-salt hash', () => {
    const staticHash = hashPinStatic('1234');
    const randomHash = hashPin('1234', 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4');
    expect(staticHash).not.toBe(randomHash);
    // Re-deriving with a zero salt should reproduce the same static hash.
    expect(hashPin('1234', '00000000000000000000000000000000')).toBe(staticHash);
  });
});

describe('session token sign/verify', () => {
  const secret = 'test-secret';

  it('round-trips a valid token', () => {
    const token = signClassic({ slug: 'warners-bakery', exp: Date.now() + 60_000, uid: 7, role: 'OWNER' }, secret);
    const payload = verifyClassic(token, secret);
    expect(payload).toMatchObject({ slug: 'warners-bakery', uid: 7, role: 'OWNER' });
  });

  it('rejects a token signed with a different secret', () => {
    const token = signClassic({ slug: 'warners-bakery', exp: Date.now() + 60_000 }, secret);
    expect(verifyClassic(token, 'wrong-secret')).toBeNull();
  });

  it('rejects a tampered payload (signature no longer matches)', () => {
    const token = signClassic({ slug: 'warners-bakery', exp: Date.now() + 60_000, role: 'STAFF' }, secret);
    const [, sig] = token.split('.');
    const tamperedBody = Buffer.from(JSON.stringify({ slug: 'warners-bakery', exp: Date.now() + 60_000, role: 'OWNER' }))
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(verifyClassic(`${tamperedBody}.${sig}`, secret)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = signClassic({ slug: 'warners-bakery', exp: Date.now() - 1000 }, secret);
    expect(verifyClassic(token, secret)).toBeNull();
  });

  it('rejects garbage input', () => {
    expect(verifyClassic('not-a-token', secret)).toBeNull();
    expect(verifyClassic('', secret)).toBeNull();
    expect(verifyClassic(null, secret)).toBeNull();
  });
});
