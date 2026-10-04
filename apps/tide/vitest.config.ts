import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts (rather than merging) so the app's dev/build
// config stays free of test-only concerns — same split as apps/runway.
// trend.ts is plain TS with no DOM dependency, so the default 'node'
// environment is enough — no need to pull in jsdom for increment 1's tests.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
});
