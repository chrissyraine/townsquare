import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Minimal adapter over Node's built-in SQLite (node:sqlite) that mimics the
// slice of Cloudflare D1's API this worker actually uses:
// env.DB.prepare(sql).bind(...).first()/.all()/.run(). This is NOT Miniflare —
// it's real SQLite executing the real schema.sql, which is enough to exercise
// genuine SQL behavior (upserts, constraints, joins, COUNT aggregates) without
// the added complexity of a full Workers-runtime test pool.
export function createTestD1() {
  const sqlite = new DatabaseSync(':memory:');
  const schema = fs.readFileSync(path.join(REPO_ROOT, 'schema.sql'), 'utf8');
  sqlite.exec(schema);
  return { DB: wrap(sqlite), _raw: sqlite };
}

function wrap(sqlite) {
  return {
    prepare(sql) {
      let params = [];
      const api = {
        bind(...args) { params = args; return api; },
        async first() {
          const row = sqlite.prepare(sql).get(...params);
          return row === undefined ? null : row;
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...params) };
        },
        async run() {
          const info = sqlite.prepare(sql).run(...params);
          return { meta: { last_row_id: Number(info.lastInsertRowid), changes: info.changes } };
        },
      };
      return api;
    },
  };
}
