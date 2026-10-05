import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${root}/` },
      // `server-only` throws outside a React Server Components build; tests run plain Node.
      { find: /^server-only$/, replacement: `${root}/test/stubs/server-only.ts` },
    ],
  },
  test: {
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**', 'e2e/**'],
    environment: 'node',
    setupFiles: ['./test/setup-env.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Integration tests share one database, so files run one at a time.
    fileParallelism: false,
    // A migration test's hook resets a database and replays every migration: 10 s ran out under load
    // (migration-008 and -007 in the phase-7 spikes, migration-006 in plan 7A's verification).
    hookTimeout: 30_000,
  },
});
