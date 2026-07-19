// One-off: light up Forever Still Studio's panel on Titusville Square.
// Enables the Herald module on the hub registry row, sets a known PIN, and writes the
// matching Herald account so announcements/hours/Town Crier can actually be posted.
// Emits two .sql files for `wrangler d1 execute` (never hand-edits prod directly).
import { scryptSync, randomBytes } from 'crypto';
import { writeFileSync } from 'fs';

const PIN = process.argv[2] || '3777';
const SLUG = 'forever-still-studio';
const NAME = 'Forever Still Studio';

const salt = randomBytes(16).toString('hex');
const hubHash = scryptSync(PIN, Buffer.from(salt, 'hex'), 32, { N: 16384, r: 8, p: 1 }).toString('hex');
// Products (Herald/Drawbridge) hash with a static zero salt.
const prodHash = scryptSync(PIN, Buffer.alloc(16, 0), 32, { N: 16384, r: 8, p: 1 }).toString('hex');

writeFileSync('lit-hub.sql',
  `UPDATE businesses SET modules='{"herald":true}', salt='${salt}', pin_hash='${hubHash}' WHERE slug='${SLUG}';\n`);
writeFileSync('lit-herald.sql',
  `INSERT OR IGNORE INTO businesses (name,slug,pin_hash) VALUES ('${NAME}','${SLUG}','${prodHash}');\n`);

console.log(`generated lit-hub.sql + lit-herald.sql for ${SLUG} (PIN ${PIN})`);
