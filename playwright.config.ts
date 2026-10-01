import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
/**
 * A server you started yourself (for example `next dev` against a local _test
 * database, to look for dev-only hydration errors). Skips the webServer below.
 */
const external = process.env.E2E_BASE_URL;

// Locally `next dev` reads .env.local (currently the shared Neon DB), so this
// config never starts it: use CI=1 with a local _test DATABASE_URL, or E2E_BASE_URL.
if (!process.env.CI && !external) {
  throw new Error(
    'Refusing to start next dev: it reads .env.local (the shared Neon DB). Use CI=1 with a local _test DATABASE_URL, or set E2E_BASE_URL.',
  );
}

export default defineConfig({
  testDir: './e2e',
  // Screenshot comparisons run separately (npm run test:visual): their baselines are macOS renderings.
  testIgnore: /\/visual[^/]*\.spec\.ts$/,
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: external ?? `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } } },
  ],
  webServer: external
    ? undefined
    : {
        // The production build, on whatever DATABASE_URL the caller set (a local _test one).
        command: `npm run start -- -p ${PORT}`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
