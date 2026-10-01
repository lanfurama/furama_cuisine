import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_ENDPOINT_BLOCKED, INVITATION_REQUIRED, type Auth } from '@/lib/server/auth/config';
import { TEST_DATABASE_URL } from '../helpers/db';
import {
  BOOTSTRAP_EMAIL,
  PASSWORD,
  STAFF_TABLES,
  TEST_BASE_URL,
  createBootstrapAdmin,
  createStaffUser,
  createTestAuth,
  errorCode,
  inviteBySql,
  post,
  signInCookie,
  type SentReset,
} from '../helpers/auth';

/*
 * The day-1 proofs of spec §16, on the real schema (migration 005), through
 * both doors: the HTTP router (auth.handler, what /api/auth/[...all] calls)
 * and the server-side auth.api.* calls the app makes.
 */

let pool: Pool;
let auth: Auth;
let sent: SentReset[];

const rows = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) =>
  (await pool.query<T>(text, values)).rows;

describe.skipIf(!TEST_DATABASE_URL)('Better Auth on migration 005', () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 8 });
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query(`TRUNCATE ${STAFF_TABLES} CASCADE`);
    sent = [];
    auth = createTestAuth(pool, { sent });
  });

  describe('who may get an account', () => {
    it('keeps HTTP sign-up closed', async () => {
      const res = await post(auth, '/sign-up/email', { email: 'x@furama.test', password: PASSWORD, name: 'X' });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe('EMAIL_PASSWORD_SIGN_UP_DISABLED');
    });

    it('refuses createUser for an email without an invitation', async () => {
      expect(await errorCode(auth.api.createUser({ body: { email: 'stranger@furama.test', password: PASSWORD, name: 'S' } }))).toBe(
        INVITATION_REQUIRED,
      );
      expect(await rows('SELECT 1 FROM staff_user')).toHaveLength(0);
    });

    it('lets BOOTSTRAP_ADMIN_EMAIL in as Admin only while no Admin exists', async () => {
      const owner = await createBootstrapAdmin(auth);
      expect(await rows('SELECT role FROM staff_user WHERE id = $1', [owner.id])).toEqual([{ role: 'admin' }]);
      auth = createTestAuth(pool, { bootstrapAdminEmail: 'second@furama.test' });
      expect(await errorCode(createBootstrapAdmin(auth, 'second@furama.test'))).toBe(INVITATION_REQUIRED);
    });

    it('takes the role from the invitation, not from the caller', async () => {
      await createBootstrapAdmin(auth);
      await inviteBySql(pool, 'ed@furama.test', 'editor');
      const { user } = await auth.api.createUser({
        body: { email: 'ed@furama.test', password: PASSWORD, name: 'Ed', role: 'admin' },
      });
      expect(await rows('SELECT role FROM staff_user WHERE id = $1', [user.id])).toEqual([{ role: 'editor' }]);
    });

    it('ignores used, revoked and expired invitations', async () => {
      await inviteBySql(pool, 'used@furama.test', 'editor');
      await inviteBySql(pool, 'revoked@furama.test', 'editor');
      await inviteBySql(pool, 'expired@furama.test', 'editor');
      await pool.query(`UPDATE staff_invitation SET used_at = now() WHERE email = 'used@furama.test'`);
      await pool.query(`UPDATE staff_invitation SET revoked_at = now() WHERE email = 'revoked@furama.test'`);
      await pool.query(`UPDATE staff_invitation SET expires_at = now() - interval '1 second' WHERE email = 'expired@furama.test'`);
      for (const email of ['used@furama.test', 'revoked@furama.test', 'expired@furama.test']) {
        expect(await errorCode(auth.api.createUser({ body: { email, password: PASSWORD, name: 'X' } }))).toBe(INVITATION_REQUIRED);
      }
    });
  });

  describe('the admin plugin endpoints (spec §7.1, §16)', () => {
    it('rejects HTTP calls to /api/auth/admin/* even from a signed-in Admin with a valid Origin', async () => {
      const owner = await createBootstrapAdmin(auth);
      const cookie = await signInCookie(auth, owner.email);
      const setRole = await post(auth, '/admin/set-role', { userId: owner.id, role: 'editor' }, { cookie });
      expect(setRole.status).toBe(403);
      expect(((await setRole.json()) as { code: string }).code).toBe(ADMIN_ENDPOINT_BLOCKED);
      const list = await auth.handler(new Request(`${TEST_BASE_URL}/api/auth/admin/list-users`, { headers: { cookie } }));
      expect(list.status).toBe(403);
      const create = await post(auth, '/admin/create-user', { email: 'n@furama.test', password: PASSWORD, name: 'N' }, { cookie });
      expect(create.status).toBe(403);
      expect(await rows('SELECT email, role FROM staff_user')).toEqual([{ email: owner.email, role: 'admin' }]);
    });

    it('still serves server-side auth.api.* calls, with the caller’s permissions', async () => {
      const owner = await createBootstrapAdmin(auth);
      const editor = await createStaffUser(auth, pool, 'ed@furama.test', 'editor');
      const adminHeaders = new Headers({ cookie: await signInCookie(auth, owner.email) });
      const editorHeaders = new Headers({ cookie: await signInCookie(auth, editor.email) });

      const listed = await auth.api.listUsers({ headers: adminHeaders, query: {} });
      expect(listed.users.map((u) => u.email).sort()).toEqual(['ed@furama.test', BOOTSTRAP_EMAIL]);
      await auth.api.setRole({ headers: adminHeaders, body: { userId: editor.id, role: 'admin' } });
      expect(await rows('SELECT role FROM staff_user WHERE id = $1', [editor.id])).toEqual([{ role: 'admin' }]);
      await auth.api.setRole({ headers: adminHeaders, body: { userId: editor.id, role: 'editor' } });

      expect(await errorCode(auth.api.setRole({ headers: editorHeaders, body: { userId: owner.id, role: 'editor' } }))).toBe(
        'YOU_ARE_NOT_ALLOWED_TO_CHANGE_USERS_ROLE',
      );
      expect(await errorCode(auth.api.listUsers({ headers: editorHeaders, query: {} }))).toBe('YOU_ARE_NOT_ALLOWED_TO_LIST_USERS');
    });

    it('grants impersonation to no role', async () => {
      const owner = await createBootstrapAdmin(auth);
      const editor = await createStaffUser(auth, pool, 'ed@furama.test', 'editor');
      const adminHeaders = new Headers({ cookie: await signInCookie(auth, owner.email) });
      expect(await errorCode(auth.api.impersonateUser({ headers: adminHeaders, body: { userId: editor.id } }))).toBe(
        'YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS',
      );
    });

    it('auth.api.setRole commits outside our transaction (why role changes use our own SQL)', async () => {
      const owner = await createBootstrapAdmin(auth);
      const editor = await createStaffUser(auth, pool, 'ed@furama.test', 'editor');
      const adminHeaders = new Headers({ cookie: await signInCookie(auth, owner.email) });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT 1');
        await auth.api.setRole({ headers: adminHeaders, body: { userId: editor.id, role: 'admin' } });
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
      // Our ROLLBACK did not undo it, so an audit row in our transaction could never be atomic with it.
      expect(await rows('SELECT role FROM staff_user WHERE id = $1', [editor.id])).toEqual([{ role: 'admin' }]);
    });
  });

  describe('sessions', () => {
    it('the next session read sees a changed role (no cookie cache)', async () => {
      await createBootstrapAdmin(auth);
      const editor = await createStaffUser(auth, pool, 'ed@furama.test', 'editor');
      const headers = new Headers({ cookie: await signInCookie(auth, editor.email) });
      expect((await auth.api.getSession({ headers }))?.user.role).toBe('editor');
      await pool.query(`UPDATE staff_user SET role = 'admin' WHERE id = $1`, [editor.id]);
      expect((await auth.api.getSession({ headers }))?.user.role).toBe('admin');
    });

    it('a session lasts 7 days and the cookie is HttpOnly, SameSite=Lax', async () => {
      const owner = await createBootstrapAdmin(auth);
      const res = await post(auth, '/sign-in/email', { email: owner.email, password: PASSWORD });
      const cookie = res.headers.getSetCookie().find((c) => c.startsWith('better-auth.session_token='));
      expect(cookie).toMatch(/Max-Age=604800/);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Lax/);
      expect(res.headers.getSetCookie().some((c) => c.startsWith('better-auth.session_data='))).toBe(false);
    });
  });

  describe('rate limit and password reset', () => {
    it('stores the sign-in rate limit in auth_rate_limit (HTTP only; auth.api.* is never limited)', async () => {
      const owner = await createBootstrapAdmin(auth);
      auth = createTestAuth(pool, { rateLimitEnabled: true });
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        const res = await post(auth, '/sign-in/email', { email: owner.email, password: 'wrong password!!' }, { 'x-forwarded-for': '198.51.100.7' });
        statuses.push(res.status);
      }
      expect(statuses).toEqual([401, 401, 401, 429]);
      expect(await rows('SELECT key, count FROM auth_rate_limit')).toEqual([{ key: '198.51.100.7|/sign-in/email', count: 3 }]);
      for (let i = 0; i < 4; i++) {
        expect(await errorCode(auth.api.signInEmail({ body: { email: owner.email, password: 'wrong password!!' } }))).toBe(
          'INVALID_EMAIL_OR_PASSWORD',
        );
      }
    });

    it('reset: request → token → new password; old sessions are revoked', async () => {
      const owner = await createBootstrapAdmin(auth);
      const oldSession = new Headers({ cookie: await signInCookie(auth, owner.email) });
      expect((await post(auth, '/request-password-reset', { email: owner.email })).status).toBe(200);
      await vi.waitFor(() => expect(sent).toHaveLength(1));
      expect(sent[0]).toMatchObject({ email: owner.email, name: 'Owner' });
      // Stored as SHA-256 only (storeIdentifier: 'hashed'), like invitation tokens.
      expect(JSON.stringify(await rows('SELECT identifier FROM staff_verification'))).not.toContain(sent[0].token);

      const reset = await post(auth, '/reset-password', { token: sent[0].token, newPassword: 'a brand new passphrase' });
      expect(reset.status).toBe(200);
      expect(await auth.api.getSession({ headers: oldSession })).toBeNull();
      expect(await signInCookie(auth, owner.email, 'a brand new passphrase')).toMatch(/session_token=/);
      expect(await errorCode(auth.api.signInEmail({ body: { email: owner.email, password: PASSWORD } }))).toBe(
        'INVALID_EMAIL_OR_PASSWORD',
      );
    });

    it('answers before the reset email is sent, so a staff address is no slower than an unknown one', async () => {
      const owner = await createBootstrapAdmin(auth);
      let started = false;
      auth = createTestAuth(pool, {
        sendResetPassword: () => {
          started = true;
          return new Promise(() => {}); // a Resend call that never returns
        },
      });
      const answer = await Promise.race([
        post(auth, '/request-password-reset', { email: owner.email }).then((res) => res.status),
        new Promise((resolve) => setTimeout(() => resolve('still waiting for the email'), 500)),
      ]);
      expect(answer).toBe(200);
      expect(started).toBe(true);
    });

    it('an unknown email gets the same 200 and no email', async () => {
      await createBootstrapAdmin(auth);
      const res = await post(auth, '/request-password-reset', { email: 'nobody@furama.test' });
      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 100));
      expect(sent).toHaveLength(0);
    });

    it('a failing reset sender is logged by its code only; the answer stays 200', async () => {
      const owner = await createBootstrapAdmin(auth);
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      auth = createTestAuth(pool, {
        sendResetPassword: async () => {
          throw Object.assign(new Error('Resend rejected the email: secret details'), { code: 'provider_error' });
        },
      });
      try {
        expect((await post(auth, '/request-password-reset', { email: owner.email })).status).toBe(200);
        await vi.waitFor(() => expect(logged).toHaveBeenCalledWith('[auth] reset email failed', { code: 'provider_error' }));
        expect(JSON.stringify(logged.mock.calls)).not.toContain('secret details');
      } finally {
        logged.mockRestore();
      }
    });
  });
});
