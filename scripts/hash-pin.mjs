// Generate a per-account salt + scrypt PIN hash for a TownSquare registry row.
// Usage:  node scripts/hash-pin.mjs <pin>
// Prints the salt and pin_hash to paste into an INSERT (see schema.sql).
import { scryptSync, randomBytes } from 'node:crypto';

const pin = process.argv[2];
if (!pin) {
  console.error('usage: node scripts/hash-pin.mjs <pin>');
  process.exit(1);
}

const salt = randomBytes(16).toString('hex');
const pin_hash = scryptSync(String(pin), Buffer.from(salt, 'hex'), 32, { N: 16384, r: 8, p: 1 }).toString('hex');

console.log('salt:    ', salt);
console.log('pin_hash:', pin_hash);
