import { randomInt } from 'node:crypto';
import { test as base, expect, type Browser, type Page, type TestInfo } from '@playwright/test';
import { hashPassword } from 'better-auth/crypto';
import pg from 'pg';

/*
 * Staff for the admin specs, written straight into the local _test database
 * (db() below refuses any other). The rows match what Better Auth
 * writes for an email-and-password account: a staff_user, plus a staff_account
 * with provider_id 'credential' whose password is better-auth/crypto
 * hashPassword() (scrypt, what sign-in verifies against). Upserts, so a run
 * resets names, roles, bans and passwords. Specs must not change these three
 * accounts' roles or bans: other spec files use them at the same time.
 */
export const STAFF = {
  admin: {
    id: 'e2e-admin',
    name: 'Chủ quán E2E',
    email: 'owner@furama.test',
    password: 'correct horse battery',
    role: 'admin',
    banned: false,
  },
  editor: {
    id: 'e2e-editor',
    name: 'Biên tập viên E2E',
    email: 'editor@furama.test',
    password: 'editor passphrase 1',
    role: 'editor',
    banned: false,
  },
  banned: {
    id: 'e2e-banned',
    name: 'Tài khoản bị khóa',
    email: 'banned@furama.test',
    password: 'banned passphrase 1',
    role: 'editor',
    banned: true,
  },
} as const;

export type SeedStaff = { id: string; name: string; email: string; password: string; role: 'admin' | 'editor'; banned: boolean };

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/**
 * Every database access of the admin specs goes through here, so the local-only
 * rule sits here too: playwright.config.ts checks DATABASE_URL only when it
 * starts the server itself, not with E2E_BASE_URL. Same rule as
 * scripts/reset-db.mjs: a local host, no query string (pg lets ?host= override
 * the host), and a name ending in _test or _ci (CI's furama_cuisine_ci).
 */
export function db(): pg.Client {
  const raw = process.env.DATABASE_URL;
  let url: URL | undefined;
  try {
    url = raw ? new URL(raw) : undefined;
  } catch {
    url = undefined;
  }
  if (!url || !LOCAL_HOSTS.includes(url.hostname) || url.search !== '' || !/^[a-z0-9_]+_(test|ci)$/.test(url.pathname.slice(1))) {
    throw new Error(
      'Refusing to touch the database: the admin specs write staff accounts with known passwords. Set DATABASE_URL to postgres://localhost:5432/<name>_test (or _ci).',
    );
  }
  return new pg.Client({ connectionString: raw });
}

/** Upserts staff accounts (the three above unless told otherwise). */
export async function seedStaff(staff: readonly SeedStaff[] = Object.values(STAFF)): Promise<void> {
  const client = db();
  await client.connect();
  try {
    await client.query('BEGIN');
    // Spec files seed from parallel workers; one at a time, or two inserts race on the email key.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('e2e-seed-staff'))");
    for (const s of staff) {
      await client.query(
        `INSERT INTO staff_user (id, name, email, email_verified, role, banned)
         VALUES ($1, $2, $3, true, $4, $5)
         ON CONFLICT (id) DO UPDATE SET name = $2, email = $3, role = $4, banned = $5, updated_at = now()`,
        [s.id, s.name, s.email, s.role, s.banned],
      );
      await client.query(
        `INSERT INTO staff_account (id, account_id, provider_id, user_id, password, updated_at)
         VALUES ($1, $2, 'credential', $2, $3, now())
         ON CONFLICT (id) DO UPDATE SET password = $3, updated_at = now()`,
        [`${s.id}-credential`, s.id, await hashPassword(s.password)],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

/*
 * Better Auth rate-limits /sign-in* to 3 tries per 10 s per client address
 * (and /request-password-reset to 3 per 60 s), counted in auth_rate_limit.
 * next start keeps a client's X-Forwarded-For (next/dist/server/base-server.js:612)
 * and the sign-in action forwards it, so each test gets an address of its own
 * and parallel tests, or a rerun within 10 s, never share a bucket.
 */
const RUN = randomInt(1, 255);
let next = 0;

export function uniqueIp(testInfo: TestInfo): string {
  next += 1;
  return `10.${RUN}.${testInfo.parallelIndex % 256}.${(next % 254) + 1}`;
}

/** Every browser context of a test sends that test's own address. */
export const test = base.extend({
  // `provide`, not Playwright's usual `use`: oxlint reads `use(...)` as a React hook call.
  context: async ({ context }, provide, testInfo) => {
    await context.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp(testInfo) });
    await provide(context);
  },
});

export { expect };

/** A second browser for the same test (another person), with an address of its own. */
export async function newVisitor(browser: Browser, testInfo: TestInfo): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueIp(testInfo) } });
  return context.newPage();
}

/** The form's own message; Next's route announcer is a second, empty role=alert. */
export const formAlert = (page: Page) => page.locator('form').getByRole('alert');

/**
 * Fills and submits the sign-in form, then waits for the action's response.
 * The next fill must not start earlier: when an action settles, React resets
 * the form, which would wipe a password typed in the meantime.
 */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  // Cache Components keeps pages you left mounted but hidden (<Activity>): role
  // queries skip them, and `exact` keeps "Mật khẩu" from matching "Đặt lại mật khẩu".
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  const answered = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/admin/sign-in',
  );
  // exact: while pending the button reads "Đang đăng nhập…", which also contains "đăng nhập".
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await answered;
}

/** Opens the sign-in page and signs in; resolves on the admin overview. */
export async function signInAs(page: Page, who: { email: string; password: string }): Promise<void> {
  await page.goto('/admin/sign-in');
  await signIn(page, who.email, who.password);
  await expect(page).toHaveURL(/\/admin$/);
}

/**
 * Runs `fn` while no other test in any worker changes how many Admins exist:
 * the last-Admin check (spec §7.1) depends on that count, so the test that
 * expects it and the tests that briefly add an Admin take this lock.
 */
export async function withAdminCountLock<T>(fn: () => Promise<T>): Promise<T> {
  const client = db();
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('e2e-admin-count'))");
    return await fn();
  } finally {
    await client.end(); // ends the session, which releases the lock even if fn threw
  }
}

/**
 * Runs `fn` while no other test, in any worker, holds the lock `name`: for a
 * test that changes a shared row and puts it back (another copy of it under
 * --repeat-each would read the row half-way). A dedicated client holds a
 * session advisory lock for the whole of `fn`; db() refuses any database but
 * a local _test/_ci one.
 */
export async function exclusive<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const client = db();
  await client.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(hashtextextended('e2e:' || $1, 0))`, [name]);
    try {
      return await fn();
    } finally {
      await client.query(`SELECT pg_advisory_unlock(hashtextextended('e2e:' || $1, 0))`, [name]);
    }
  } finally {
    await client.end(); // ends the session too, which would release the lock if the unlock failed
  }
}

/** One row of a query, for assertions on what the database holds. */
export async function one<T extends Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<T | undefined> {
  const client = db();
  await client.connect();
  try {
    return (await client.query<T>(sql, values)).rows[0];
  } finally {
    await client.end();
  }
}
