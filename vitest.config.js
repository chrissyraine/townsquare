import { defineConfig } from 'vitest/config';

// Backend tests only (public/_worker.js) — plain Node, no browser/DOM needed,
// and deliberately NOT sharing vite.config.js's React plugin since none of
// these tests touch JSX.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
  },
});
