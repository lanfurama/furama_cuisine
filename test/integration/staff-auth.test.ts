import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { insertAudit, withTransaction } from '@/lib/server/audit';
import { INVITATION_REQUIRED, type Auth } from '@/lib/server/auth/config';
import {
  acceptInvitation,
  banStaff,
  createInvitation,
  findOpenInvitation,
  removeStaff,
  resendInvitation,
  revokeInvitation,
  setStaffRole,
  unbanStaff,
  type SendInvite,
  type StaffDeps,
} from '@/lib/server/auth/staff';
import { sendStaffInvitation } from '@/lib/server/email/auth-emails';
import { createEmailSender } from '@/lib/server/email/send';
import { EmailSendError } from '@/lib/server/email/types';
import { TEST_DATABASE_URL } from '../helpers/db';
import { PASSWORD, STAFF_TABLES, createBootstrapAdmin, createTestAuth, errorCode, signInCookie } from '../helpers/auth';

/*
 * Staff management (spec §7.1) on the real schema: invitations, accepting one,
 * role changes, ban and removal, each with its audit row in the same
 * transaction (spec §7.4), and the last-Admin rule.
 */

type Invite = Parameters<SendInvite>[0];

let pool: Pool;
let auth: Auth;
let invites: Invite[];
let failNext: Error | null;

function deps(): StaffDeps {
  return {
    pool,
    auth,
    sendInvite: async (args) => {
      if (failNext) {
        const err = failNext;
        failNext = null;
        throw err;
      }
      invites.push(args);
    },
  };
}

const rows = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) =>
  (await pool.query<T>(text, values)).rows;
const lastToken = () => invites.at(-1)!.token;

async function owner() {
  const user = await createBootstrapAdmin(auth);
  return { ...user, name: 'Owner', ip: '203.0.113.9' };
}

/** Invites and accepts in one go; returns the new staff member as an actor. */
async function onboard(actor: { id: string; email: string }, email: string, role: 'admin' | 'editor') {
  expect(await createInvitation(deps(), actor, { email, role })).toMatchObject({ ok: true });
  const accepted = await acceptInvitation(deps(), { token: lastToken(), name: email, password: PASSWORD });
  if (!accepted.ok) throw new Error(accepted.code);
  return { id: accepted.userId, email };
}

describe.skipIf(!TEST_DATABASE_URL)('staff management on migration 005', () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 8 });
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query(`TRUNCATE ${STAFF_TABLES} CASCADE`);
    invites = [];
    failNext = null;
    auth = createTestAuth(pool);
  });

  describe('invitations', () => {
    it('invite → accept → sign in, with one audit row per step and a single-use token', async () => {
      const admin = await owner();
      const invited = await createInvitation(deps(), admin, { email: 'Ed@Furama.test', role: 'editor' });
      expect(invited).toMatchObject({ ok: true, emailSent: true });
      expect(invites[0]).toMatchObject({ to: 'ed@furama.test', role: 'editor', inviterName: 'Owner' });
      expect(invites[0].token).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const [stored] = await rows<{ token_hash: string; email_error: string | null }>('SELECT token_hash, email_error FROM staff_invitation');
      expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored.token_hash).not.toContain(invites[0].token);
      expect(stored.email_error).toBeNull();

      const accepted = await acceptInvitation(deps(), { token: lastToken(), name: 'Ed', password: PASSWORD }, '198.51.100.20');
      expect(accepted).toMatchObject({ ok: true, email: 'ed@furama.test' });
      expect(await rows('SELECT role, email_verified FROM staff_user WHERE email = $1', ['ed@furama.test'])).toEqual([
        { role: 'editor', email_verified: true },
      ]);
      expect(await signInCookie(auth, 'ed@furama.test')).toMatch(/session_token=/);

      expect(await acceptInvitation(deps(), { token: lastToken(), name: 'Ed', password: PASSWORD })).toEqual({
        ok: false,
        code: 'invalid_token',
      });
      expect(await rows('SELECT action, actor_id, host(ip) AS ip FROM audit_log ORDER BY id')).toEqual([
        { action: 'staff.invite', actor_id: admin.id, ip: '203.0.113.9' },
        { action: 'staff.invite_accept', actor_id: accepted.ok ? accepted.userId : null, ip: '198.51.100.20' },
      ]);
      // The token is in no audit row.
      expect(JSON.stringify(await rows('SELECT before, after FROM audit_log'))).not.toContain(invites[0].token);
    });

    it('a failed send keeps the invitation and records the error; a resend that works clears it', async () => {
      const admin = await owner();
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      failNext = new EmailSendError('provider_error', 'Resend rejected the email: rate limited');
      const invited = await createInvitation(deps(), admin, { email: 'ed@furama.test', role: 'editor' });
      expect(invited).toMatchObject({ ok: true, emailSent: false, emailError: 'provider_error' });
      expect(await rows('SELECT email_error FROM staff_invitation')).toEqual([
        { email_error: 'provider_error: Resend rejected the email: rate limited' },
      ]);
      expect(errors).toHaveBeenCalledWith('[staff] invite email failed', { id: invited.ok ? invited.id : '', code: 'provider_error' });
      errors.mockRestore();

      if (!invited.ok) throw new Error('unreachable');
      expect(await resendInvitation(deps(), admin, invited.id)).toEqual({ ok: true, emailSent: true });
      expect(await rows('SELECT email_error FROM staff_invitation')).toEqual([{ email_error: null }]);
    });

    it('log mode on a Vercel deployment is not a sent invitation: email_error records not_delivered', async () => {
      const admin = await owner();
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      // The real sender, as on a Preview whose EMAIL_DELIVERY is unset.
      const send = createEmailSender({ env: { VERCEL_ENV: 'preview' }, logSink: () => {} });
      const sendInvite: SendInvite = (email) => sendStaffInvitation(email, send);
      const invited = await createInvitation({ ...deps(), sendInvite }, admin, { email: 'ed@furama.test', role: 'editor' });
      expect(invited).toMatchObject({ ok: true, emailSent: false, emailError: 'not_delivered' });
      const [stored] = await rows<{ email_error: string }>('SELECT email_error FROM staff_invitation');
      expect(stored.email_error).toMatch(/^not_delivered: EMAIL_DELIVERY is log \(or unset\) on a Vercel preview deployment/);
      if (!invited.ok) throw new Error('unreachable');
      expect(await resendInvitation({ ...deps(), sendInvite }, admin, invited.id)).toEqual({ ok: true, emailSent: false, emailError: 'not_delivered' });
      errors.mockRestore();
    });

    it('refuses a second open invitation and an email that already has an account', async () => {
      const admin = await owner();
      await createInvitation(deps(), admin, { email: 'ed@furama.test', role: 'editor' });
      expect(await createInvitation(deps(), admin, { email: 'ED@furama.test', role: 'admin' })).toEqual({
        ok: false,
        code: 'already_invited',
      });
      expect(await createInvitation(deps(), admin, { email: admin.email, role: 'editor' })).toEqual({
        ok: false,
        code: 'already_staff',
      });
    });

    it('resend issues a new token and kills the old one', async () => {
      const admin = await owner();
      const invited = await createInvitation(deps(), admin, { email: 'ed@furama.test', role: 'editor' });
      if (!invited.ok) throw new Error('unreachable');
      const first = lastToken();
      expect(await resendInvitation(deps(), admin, invited.id)).toEqual({ ok: true, emailSent: true });
      const second = lastToken();
      expect(second).not.toBe(first);
      expect(await findOpenInvitation(pool, first)).toBeNull();
      expect(await findOpenInvitation(pool, second)).toMatchObject({ email: 'ed@furama.test', role: 'editor' });
      expect(await rows(`SELECT action FROM audit_log WHERE entity_type = 'staff_invitation' ORDER BY id`)).toEqual([
        { action: 'staff.invite' },
        { action: 'staff.invite_resend' },
      ]);
    });

    it('revoke closes the link and the account gate', async () => {
      const admin = await owner();
      const invited = await createInvitation(deps(), admin, { email: 'ed@furama.test', role: 'editor' });
      if (!invited.ok) throw new Error('unreachable');
      expect(await revokeInvitation(deps(), admin, invited.id)).toEqual({ ok: true });
      expect(await revokeInvitation(deps(), admin, invited.id)).toEqual({ ok: false, code: 'not_found' });
      expect(await acceptInvitation(deps(), { token: lastToken(), name: 'Ed', password: PASSWORD })).toEqual({
        ok: false,
        code: 'invalid_token',
      });
      expect(await errorCode(auth.api.createUser({ body: { email: 'ed@furama.test', password: PASSWORD, name: 'Ed' } }))).toBe(
        INVITATION_REQUIRED,
      );
      expect(await rows(`SELECT revoked_at IS NOT NULL AS revoked FROM staff_invitation`)).toEqual([{ revoked: true }]);
    });

    it('an expired invitation cannot be accepted, and the email can be invited again', async () => {
      const admin = await owner();
      await createInvitation(deps(), admin, { email: 'ed@furama.test', role: 'editor' });
      const stale = lastToken();
      await pool.query(`UPDATE staff_invitation SET expires_at = now() - interval '1 second'`);
      expect(await acceptInvitation(deps(), { token: stale, name: 'Ed', password: PASSWORD })).toEqual({
        ok: false,
        code: 'invalid_token',
      });
      expect(await createInvitation(deps(), admin, { email: 'ed@furama.test', role: 'admin' })).toMatchObject({ ok: true });
      expect(await rows('SELECT role, revoked_at IS NOT NULL AS revoked FROM staff_invitation ORDER BY id')).toEqual([
        { role: 'editor', revoked: true },
        { role: 'admin', revoked: false },
      ]);
    });

    it('rejects malformed tokens without a query', async () => {
      for (const token of ['', 'short', `${'a'.repeat(43)}=`, `${'a'.repeat(42)}!`]) {
        expect(await findOpenInvitation(pool, token)).toBeNull();
      }
    });

    it('two racing accepts of one token create one account', async () => {
      const admin = await owner();
      await createInvitation(deps(), admin, { email: 'ed@furama.test', role: 'editor' });
      const t = lastToken();
      const results = await Promise.allSettled([
        acceptInvitation(deps(), { token: t, name: 'A', password: PASSWORD }),
        acceptInvitation(deps(), { token: t, name: 'B', password: PASSWORD }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled' && r.value.ok)).toHaveLength(1);
      expect(await rows(`SELECT 1 FROM staff_user WHERE email = 'ed@furama.test'`)).toHaveLength(1);
    });

    // An account created while its invitation stayed open: what acceptInvitation
    // leaves behind when createUser succeeds and the "mark used" write fails.
    it('removing the member closes an invitation left open, so its link cannot recreate the account', async () => {
      const admin = await owner();
      await createInvitation(deps(), admin, { email: 'ed@furama.test', role: 'admin' });
      const stuck = lastToken();
      const { user } = await auth.api.createUser({ body: { email: 'ed@furama.test', password: PASSWORD, name: 'Ed' } });
      expect(await removeStaff(pool, admin, user.id)).toEqual({ ok: true });
      expect(await acceptInvitation(deps(), { token: stuck, name: 'Ed', password: PASSWORD })).toEqual({
        ok: false,
        code: 'invalid_token',
      });
      expect(await rows(`SELECT 1 FROM staff_user WHERE email = 'ed@furama.test'`)).toHaveLength(0);
    });

    it('a revoke landing between createUser and mark-used still writes the accept audit row', async () => {
      const admin = await owner();
      const invited = await createInvitation(deps(), admin, { email: 'ed@furama.test', role: 'editor' });
      if (!invited.ok) throw new Error('unreachable');
      const racing: StaffDeps = {
        ...deps(),
        auth: {
          ...auth,
          api: {
            ...auth.api,
            createUser: async (...args: Parameters<Auth['api']['createUser']>) => {
              const created = await auth.api.createUser(...args);
              await revokeInvitation(deps(), admin, invited.id);
              return created;
            },
          },
        } as Auth,
      };
      expect(await acceptInvitation(racing, { token: lastToken(), name: 'Ed', password: PASSWORD })).toMatchObject({ ok: true });
      expect(await rows(`SELECT 1 FROM audit_log WHERE action = 'staff.invite_accept'`)).toHaveLength(1);
      expect(await rows('SELECT revoked_at IS NOT NULL AS revoked, used_at IS NULL AS unused FROM staff_invitation')).toEqual([
        { revoked: true, unused: true },
      ]);
    });

    it('reopening a link whose account exists answers already_staff and closes the invitation', async () => {
      const admin = await owner();
      await createInvitation(deps(), admin, { email: 'ed@furama.test', role: 'editor' });
      const stuck = lastToken();
      await auth.api.createUser({ body: { email: 'ed@furama.test', password: PASSWORD, name: 'Ed' } });
      expect(await acceptInvitation(deps(), { token: stuck, name: 'Ed', password: PASSWORD })).toEqual({
        ok: false,
        code: 'already_staff',
      });
      expect(await findOpenInvitation(pool, stuck)).toBeNull();
    });
  });

  describe('role changes and the last Admin', () => {
    it('a role change writes exactly one audit row, with the acting Admin', async () => {
      const admin = await owner();
      const editor = await onboard(admin, 'ed@furama.test', 'editor');
      await pool.query('DELETE FROM audit_log');

      expect(await setStaffRole(pool, admin, { userId: editor.id, role: 'admin' })).toEqual({ ok: true, changed: true });
      expect(
        await rows('SELECT actor_id, actor_email, action, entity_type, entity_id, before, after, host(ip) AS ip FROM audit_log'),
      ).toEqual([
        {
          actor_id: admin.id,
          actor_email: admin.email,
          action: 'staff.role',
          entity_type: 'staff_user',
          entity_id: editor.id,
          before: { role: 'editor' },
          after: { role: 'admin' },
          ip: '203.0.113.9',
        },
      ]);
      // Setting the same role again changes nothing and logs nothing.
      expect(await setStaffRole(pool, admin, { userId: editor.id, role: 'admin' })).toEqual({ ok: true, changed: false });
      expect(await rows('SELECT 1 FROM audit_log')).toHaveLength(1);
    });

    it('cannot demote, ban or remove the last Admin; a banned Admin does not count', async () => {
      const admin = await owner();
      expect(await setStaffRole(pool, admin, { userId: admin.id, role: 'editor' })).toEqual({ ok: false, code: 'last_admin' });
      expect(await removeStaff(pool, admin, admin.id)).toEqual({ ok: false, code: 'self' });
      expect(await banStaff(pool, admin, admin.id)).toEqual({ ok: false, code: 'self' });
      const other = await onboard(admin, 'second@furama.test', 'admin');
      await pool.query('UPDATE staff_user SET banned = true WHERE id = $1', [other.id]);
      expect(await setStaffRole(pool, admin, { userId: admin.id, role: 'editor' })).toEqual({ ok: false, code: 'last_admin' });
      expect(await removeStaff(pool, other, admin.id)).toEqual({ ok: false, code: 'last_admin' });
      expect(await banStaff(pool, other, admin.id)).toEqual({ ok: false, code: 'last_admin' });
      expect(await rows(`SELECT 1 FROM audit_log WHERE action IN ('staff.role', 'staff.remove', 'staff.ban')`)).toHaveLength(0);
    });

    it('two Admins demoting each other at once leave one Admin', async () => {
      const a = await owner();
      const b = await onboard(a, 'second@furama.test', 'admin');
      const results = await Promise.all([
        setStaffRole(pool, a, { userId: b.id, role: 'editor' }),
        setStaffRole(pool, b, { userId: a.id, role: 'editor' }),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, code: 'last_admin' }]);
      expect(await rows(`SELECT 1 FROM staff_user WHERE role = 'admin'`)).toHaveLength(1);
      expect(await rows(`SELECT 1 FROM audit_log WHERE action = 'staff.role'`)).toHaveLength(1);
    });

    it('a failed audit insert rolls the change back (same transaction)', async () => {
      const admin = await owner();
      const editor = await onboard(admin, 'ed@furama.test', 'editor');
      await expect(
        withTransaction(pool, async (c) => {
          await c.query(`UPDATE staff_user SET role = 'admin' WHERE id = $1`, [editor.id]);
          await insertAudit(c, admin, { action: 'not-an-action', entityType: 'staff_user', entityId: editor.id });
        }),
      ).rejects.toThrow(/audit_log_action_check/);
      expect(await rows('SELECT role FROM staff_user WHERE id = $1', [editor.id])).toEqual([{ role: 'editor' }]);
    });

    it('stores no IP for an IPv6 address with a zone id, which inet rejects', async () => {
      const admin = await owner();
      await withTransaction(pool, (c) =>
        insertAudit(c, { ...admin, ip: 'fe80::1%lo0' }, { action: 'staff.role', entityType: 'staff_user', entityId: admin.id }),
      );
      expect(await rows('SELECT ip FROM audit_log')).toEqual([{ ip: null }]);
    });

    it('stores no IP that is not an address', async () => {
      const admin = await owner();
      await withTransaction(pool, (c) =>
        insertAudit(c, { ...admin, ip: 'not-an-ip' }, { action: 'staff.role', entityType: 'staff_user', entityId: admin.id }),
      );
      expect(await rows('SELECT ip FROM audit_log')).toEqual([{ ip: null }]);
    });
  });

  describe('ban, unban and removal', () => {
    it('ban signs the member out everywhere, keeps them out, and logs it; unban logs too', async () => {
      const admin = await owner();
      const editor = await onboard(admin, 'ed@furama.test', 'editor');
      const headers = new Headers({ cookie: await signInCookie(auth, editor.email) });

      expect(await banStaff(pool, admin, editor.id)).toEqual({ ok: true, changed: true });
      expect(await auth.api.getSession({ headers })).toBeNull();
      expect(await rows('SELECT 1 FROM staff_session WHERE user_id = $1', [editor.id])).toHaveLength(0);
      expect(await errorCode(auth.api.signInEmail({ body: { email: editor.email, password: PASSWORD } }))).toBe('BANNED_USER');
      expect(await banStaff(pool, admin, editor.id)).toEqual({ ok: true, changed: false });

      expect(await unbanStaff(pool, admin, editor.id)).toEqual({ ok: true, changed: true });
      expect(await signInCookie(auth, editor.email)).toMatch(/session_token=/);
      expect(await unbanStaff(pool, admin, editor.id)).toEqual({ ok: true, changed: false });
      expect(await rows(`SELECT action, before, after FROM audit_log WHERE action IN ('staff.ban', 'staff.unban') ORDER BY id`)).toEqual([
        { action: 'staff.ban', before: { banned: false }, after: { banned: true } },
        { action: 'staff.unban', before: { banned: true }, after: { banned: false } },
      ]);
      expect(await banStaff(pool, admin, 'nobody')).toEqual({ ok: false, code: 'not_found' });
    });

    it('removing staff deletes their sessions and logs the removal', async () => {
      const admin = await owner();
      const editor = await onboard(admin, 'ed@furama.test', 'editor');
      const headers = new Headers({ cookie: await signInCookie(auth, editor.email) });
      expect(await removeStaff(pool, admin, editor.id)).toEqual({ ok: true });
      expect(await auth.api.getSession({ headers })).toBeNull();
      expect(await rows(`SELECT actor_id, before->>'email' AS email FROM audit_log WHERE action = 'staff.remove'`)).toEqual([
        { actor_id: admin.id, email: 'ed@furama.test' },
      ]);
      expect(await removeStaff(pool, admin, editor.id)).toEqual({ ok: false, code: 'not_found' });
    });
  });
});
