import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// E2E_PORT: run beside another server that already holds 3100.
const PORT = Number(process.env.E2E_PORT) || 3100;
/**
 * The local stand-in for Vercel Blob (test/helpers/fake-blob.ts), started
 * below beside the app: never the real service (spec §11; outline C15).
 * FAKE_BLOB_PORT moves it like E2E_PORT moves the app (CI: 3102).
 */
const FAKE_BLOB_PORT = Number(process.env.FAKE_BLOB_PORT) || 3102;
const FAKE_BLOB_ORIGIN = `http://127.0.0.1:${FAKE_BLOB_PORT}`;
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
  // The fake store's read-write token is vercel_blob_rw_fakestore_<secret>; the secret is this run's own,
  // like CRON_SECRET, so a left-over fake or app from another run never answers for this one.
  if (!/^[A-Za-z0-9]{16,}$/.test(process.env.FAKE_BLOB_SECRET ?? '')) {
    throw new Error('Refusing to start the app: set FAKE_BLOB_SECRET to 16 or more letters and digits (for example $(openssl rand -hex 16)), the fake Blob store’s secret for this run.');
  }
  // The specs (and their workers, which inherit this process's environment) reach the fake here.
  process.env.FAKE_BLOB_ORIGIN = FAKE_BLOB_ORIGIN;
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
    // A project's testIgnore replaces the top-level one, so the visual pattern is repeated here.
    {
      name: 'desktop',
      testIgnore: [/\/visual[^/]*\.spec\.ts$/, /\.serial\.spec\.ts$/],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } },
    },
    // Specs that change what every guest page reads (a restaurant's booking switch, the
    // shared inbox) run after all the others, and one file at a time (R21): each puts the
    // data back at its end, but another serial file must not see the middle.
    {
      name: 'desktop-serial',
      testMatch: /\.serial\.spec\.ts$/,
      dependencies: ['desktop'],
      workers: 1,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } },
    },
  ],
  webServer: external
    ? undefined
    : [
        {
          // First, so the app never starts without it. Node runs the .ts module directly (type stripping).
          command: 'node test/helpers/fake-blob-cli.mjs',
          url: `${FAKE_BLOB_ORIGIN}/__fake/health`,
          reuseExistingServer: false,
          timeout: 30_000,
          env: { FAKE_BLOB_PORT: String(FAKE_BLOB_PORT), FAKE_BLOB_SECRET: process.env.FAKE_BLOB_SECRET ?? '' },
        },
        {
          // The production build, on whatever DATABASE_URL the caller set (a local _test one). Only this
          // process gets the fake store: its token (the build and the visual server keep the Blob variables
          // blank), no SDK retries, and blob-redirect.mjs preloaded, which sends every request for
          // vercel.com/api/blob or *.public.blob.vercel-storage.com to the fake and refuses every other
          // external host (next/image's fetches included).
          command: `npm run start -- -p ${PORT}`,
          url: `http://localhost:${PORT}`,
          reuseExistingServer: false,
          timeout: 120_000,
          env: {
            BLOB_READ_WRITE_TOKEN: `vercel_blob_rw_fakestore_${process.env.FAKE_BLOB_SECRET ?? ''}`,
            VERCEL_BLOB_RETRIES: '0',
            FAKE_BLOB_ORIGIN,
            // A file URL: the checkout's path may hold a space, which NODE_OPTIONS would split on.
            NODE_OPTIONS: `--import=${pathToFileURL(join(__dirname, 'test', 'helpers', 'blob-redirect.mjs')).href}`,
          },
        },
      ],
});
