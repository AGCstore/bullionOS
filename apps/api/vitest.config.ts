import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Integration tests hit the running API/DB and are slower.
    // Keep a generous timeout but fail loud on hangs.
    testTimeout: 30_000,
    // Make sure fixtures clean up even if an assertion mid-test fails.
    passWithNoTests: false,
    // Globals off — prefer explicit imports for readability.
    globals: false,
    env: {
      // Default DATABASE_URL used by integration tests when they need to
      // verify DB state directly. Override with real env when pointing at a
      // dedicated test schema.
      DATABASE_URL:
        process.env.DATABASE_URL ??
        'postgres://agc:agc_dev_password@localhost:5432/agc_crm',
      API_BASE_URL: process.env.API_BASE_URL ?? 'http://localhost:4000',
    },
  },
});
