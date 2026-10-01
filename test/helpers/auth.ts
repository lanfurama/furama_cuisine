import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { expect } from 'vitest';
import { createAuth, type Auth, type AuthDeps } from '@/lib/server/auth/config';
import type { StaffRole } from '@/lib/server/auth/permissions';

/*
 * Better Auth for integration tests: the app's own config (lib/server/auth/
 * config.ts) on the integration database, with fixed values instead of env.
 * Reset emails land in `sent` instead of going anywhere. Background work runs
 * unawaited, as after() runs it in the app.
 */

export const TEST_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
export const TEST_BASE_URL = 'http://localhost:3000';
export const BOOTSTRAP_EMAIL = 'owner@furama.test';
export const PASSWORD = 'correct horse battery';

/** Every staff table; session and account rows go with staff_user (CASCADE). */
export const STAFF_TABLES = 'staff_user, staff_invitation, audit_log, auth_rate_limit, staff_verification';

export type SentReset = { email: string; name: string; token: string };

export function createTestAuth(pool: Pool, overrides: Partial<AuthDeps> & { sent?: SentReset[] } = {}): Auth {
  const { sent, ...rest } = overrides;
  return createAuth({
    pool,
    secret: TEST_SECRET,
    baseURL: TEST_BASE_URL,
    bootstrapAdminEmail: BOOTSTRAP_EMAIL,
    sendResetPassword: async ({ user, token }) => {
      sent?.push({ email: user.email, name: user.name, token });
    },
    backgroundTask: (task) => {
      void task;
    },
    ...rest,
  });
}

/** A JSON POST to one of Better Auth's HTTP endpoints, the way a browser (or our Server Actions) reaches it. */
export function post(auth: Auth, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return auth.handler(
    new Request(`${TEST_BASE_URL}/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: TEST_BASE_URL, ...headers },
      body: JSON.stringify(body),
    }),
  );
}

/** Signs in over HTTP and returns the Cookie header for later calls. */
export async function signInCookie(auth: Auth, email: string, password = PASSWORD, ip = '198.51.100.1'): Promise<string> {
  const res = await post(auth, '/sign-in/email', { email, password }, { 'x-forwarded-for': ip });
  expect(res.status).toBe(200);
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

/** The first Admin, through the BOOTSTRAP_ADMIN_EMAIL exception (no Admin may exist yet). */
export async function createBootstrapAdmin(auth: Auth, email = BOOTSTRAP_EMAIL): Promise<{ id: string; email: string }> {
  const { user } = await auth.api.createUser({ body: { email, password: PASSWORD, name: 'Owner', role: 'admin' } });
  return { id: user.id, email: user.email };
}

/** An open invitation written straight into the table; returns the raw token. */
export async function inviteBySql(pool: Pool, email: string, role: StaffRole): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO staff_invitation (email, role, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '7 days')`,
    [email, role, createHash('sha256').update(token).digest('hex')],
  );
  return token;
}

/** A staff member created the way an accepted invitation creates one (the gate reads the invitation). */
export async function createStaffUser(auth: Auth, pool: Pool, email: string, role: StaffRole): Promise<{ id: string; email: string }> {
  await inviteBySql(pool, email, role);
  const { user } = await auth.api.createUser({ body: { email, password: PASSWORD, name: email } });
  await pool.query('UPDATE staff_invitation SET used_at = now() WHERE email = $1 AND used_at IS NULL', [email]);
  return { id: user.id, email: user.email };
}

/** The Better Auth error code of a rejected auth.api.* call, or undefined when it succeeded. */
export async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (err) {
    const body = (err as { body?: { code?: string } }).body;
    if (body?.code) return body.code;
    throw err;
  }
  return undefined;
}
