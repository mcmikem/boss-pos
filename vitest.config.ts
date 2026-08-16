import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests live next to the code in src/. The integration smoke suite
    // (tests/smoke.test.js) uses node:test and runs separately via `npm test`.
    include: ['src/**/*.test.{ts,tsx}'],
  },
});