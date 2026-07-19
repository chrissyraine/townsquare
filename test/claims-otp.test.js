import { describe, it, expect } from 'vitest';
import { genOtpCode, hashOtpCode } from '../public/_worker.js';

describe('claim OTP helpers', () => {
  it('generates a 6-digit numeric code', () => {
    for (let i = 0; i < 20; i++) {
      const code = genOtpCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it('the same code+secret always hashes the same way', () => {
    expect(hashOtpCode('123456', 'secret-a')).toBe(hashOtpCode('123456', 'secret-a'));
  });

  it('a different code or a different secret produces a different hash', () => {
    expect(hashOtpCode('123456', 'secret-a')).not.toBe(hashOtpCode('654321', 'secret-a'));
    expect(hashOtpCode('123456', 'secret-a')).not.toBe(hashOtpCode('123456', 'secret-b'));
  });
});
