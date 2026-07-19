// Set a business's PIN everywhere it lives, in one shot.
//   node scripts/set-pin.mjs <slug> <pin>
//
// A PIN is stored in THREE places and all must agree, or login is inconsistent:
//   1. businesses.pin_hash/salt        (hub, per-account random salt) — legacy/fallback path
//   2. users.pin_hash/salt             (hub, per-user random salt)   — what login checks FIRST
//   3. herald.businesses.pin_hash      (product, STATIC zero salt)   — direct product login
// Miss #2 and the PIN appears unchanged, because the users row wins.
//
// Emits .sql for `wrangler d1 execute` rather than hand-editing prod.
import { scryptSync, randomBytes } from 'crypto';
import { writeFileSync } from 'fs';

const [slug, pin] = process.argv.slice(2);
if (!slug || !/^\d{4,8}$/.test(pin || '')) {
  console.error('usage: node scripts/set-pin.mjs <slug> <4-8 digit pin>');
  process.exit(1);
}
const hash = (p, saltHex) => scryptSync(p, Buffer.from(saltHex, 'hex'), 32, { N: 16384, r: 8, p: 1 }).toString('hex');

const bizSalt = randomBytes(16).toString('hex');
const userSalt = randomBytes(16).toString('hex');
// Products hash with a static zero salt.
const prodHash = scryptSync(pin, Buffer.alloc(16, 0), 32, { N: 16384, r: 8, p: 1 }).toString('hex');

writeFileSync('setpin-hub.sql',
  `UPDATE businesses SET salt='${bizSalt}', pin_hash='${hash(pin, bizSalt)}' WHERE slug='${slug}';\n` +
  `UPDATE users SET salt='${userSalt}', pin_hash='${hash(pin, userSalt)}'\n` +
  ` WHERE business_id=(SELECT id FROM businesses WHERE slug='${slug}') AND role='OWNER';\n`);
writeFileSync('setpin-herald.sql',
  `UPDATE businesses SET pin_hash='${prodHash}' WHERE slug='${slug}';\n`);

console.log(`generated setpin-hub.sql + setpin-herald.sql for ${slug}`);
