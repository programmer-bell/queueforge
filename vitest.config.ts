import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // DB-backed suite sharing one Postgres: run everything sequentially in a
    // single thread so test files never steal each other's rows.
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
    testTimeout: 30000,
  },
});
