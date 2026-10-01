import { defineConfig, devices } from '@playwright/test';

// E2E_PORT: run beside another server that already holds 3100.
const PORT = Number(process.env.E2E_PORT) || 3100;
/**
 * A server you started yourself (for example `next dev` against a local _test
 * database, to look for dev-only hydration errors). Skips the webServer below.
 */
const external = process.env.E2E_BASE_URL || undefined;

// Both `next dev` and `next start` read .env.local (currently the shared Neon
// DB), so without a server of your own this config only starts the production
// build, and only against a local database.
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

function isLocalDatabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    // pg lets a query string (?host=...) override the hostname, so none is allowed.
    return LOCAL_HOSTS.includes(parsed.hostname) && parsed.search === '';
  } catch {
    return false;
  }
}

if (!external) {
  if (!process.env.CI) {
    throw new Error(
      'Refusing to start next dev: it reads .env.local (the shared Neon DB). Use CI=1 with a local _test DATABASE_URL, or set E2E_BASE_URL.',
    );
  }
  if (!isLocalDatabaseUrl(process.env.DATABASE_URL)) {
    throw new Error(
      'Refusing to start the app: next start reads .env.local (the shared Neon database). Set DATABASE_URL to a local postgres://localhost:5432/<name>_test database, or set E2E_BASE_URL to a server you started with local env.',
    );
  }
  // The admin specs sign in and read emailed links: the server needs its own auth
  // settings, and must never send real mail (.env.local may say EMAIL_DELIVERY=live).
  if (process.env.EMAIL_DELIVERY !== 'log') {
    throw new Error('Refusing to start the app: set EMAIL_DELIVERY=log, so no test sends real mail (process env beats .env.local).');
  }
  if (!process.env.BETTER_AUTH_SECRET) {
    throw new Error('Refusing to start the app: set BETTER_AUTH_SECRET (for example $(openssl rand -base64 32)).');
  }
  if (process.env.BETTER_AUTH_URL !== `http://localhost:${PORT}`) {
    throw new Error(`Refusing to start the app: set BETTER_AUTH_URL=http://localhost:${PORT}, the server's own origin (links and Better Auth's origin check use it).`);
  }
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
