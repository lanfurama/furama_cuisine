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
  },
});
