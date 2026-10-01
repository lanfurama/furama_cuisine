import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { isAPIError } from 'better-auth/api';
import type { Pool, PoolClient } from 'pg';
import { insertAudit, withTransaction, type AuditActor } from '@/lib/server/audit';
import { describeEmailError } from '@/lib/server/email/types';
import { INVITATION_REQUIRED, type Auth } from './config';
import type { StaffRole } from './permissions';
import { normalizeEmail } from './signup-gate';

/*
 * Staff management (spec §7.1). Callers are Server Actions that already ran
 * requirePermission and zod; everything here takes its dependencies as
 * arguments so the integration tests drive it without Next.
 *
 * Role changes, bans and removals do NOT go through auth.api.setRole/banUser/
 * removeUser: those commit on Better Auth's own connection, outside our
 * transaction (test/integration/better-auth.test.ts proves it), so the audit
 * row and the last-Admin check could not commit atomically with them. The SQL
 * below is the write those endpoints make. Never call auth.api.* while holding
 * a client from withTransaction: it is not atomic and the pool has 5 slots.
 */

export type InviteEmail = { to: string; token: string; invitationId: string; role: StaffRole; inviterName: string };
export type SendInvite = (email: InviteEmail) => Promise<unknown>;
export type StaffDeps = { pool: Pool; auth: Auth; sendInvite: SendInvite };
type Fail<C extends string> = { ok: false; code: C };

export const INVITE_TTL = '7 days';
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 32 random bytes as base64url (43 characters); only the hash is stored. */
export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

/** Sends after the commit; a failure is stored in email_error, never thrown (spec §7.1 step 5). */
async function deliverInvite(
  deps: StaffDeps,
  invitation: { id: string; email: string; role: StaffRole },
  token: string,
  actor: AuditActor,
): Promise<boolean> {
  try {
    await deps.sendInvite({
      to: invitation.email,
      token,
      invitationId: invitation.id,
      role: invitation.role,
      inviterName: actor.name ?? actor.email,
    });
    await deps.pool.query('UPDATE staff_invitation SET email_error = NULL WHERE id = $1', [invitation.id]);
    return true;
  } catch (err) {
    const emailError = describeEmailError(err);
    console.error('[staff] invite email failed', { id: invitation.id, code: emailError.split(':')[0] });
    await deps.pool.query('UPDATE staff_invitation SET email_error = $2 WHERE id = $1', [invitation.id, emailError]);
    return false;
  }
}

export async function createInvitation(
  deps: StaffDeps,
  actor: AuditActor,
  input: { email: string; role: StaffRole },
): Promise<{ ok: true; id: string; emailSent: boolean } | Fail<'already_staff' | 'already_invited'>> {
  const email = normalizeEmail(input.email);
  const { token, hash } = newInviteToken();

  const created = await withTransaction(deps.pool, async (c) => {
    const staff = await c.query('SELECT 1 FROM staff_user WHERE email = $1', [email]);
    if (staff.rowCount) return { ok: false as const, code: 'already_staff' as const };
    // An expired invitation still holds the one-open-per-email index; close it first.
    await c.query(
      `UPDATE staff_invitation SET revoked_at = now()
        WHERE email = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at <= now()`,
      [email],
    );
    const { rows } = await c.query<{ id: string; expires_at: Date }>(
      `INSERT INTO staff_invitation (email, role, token_hash, expires_at, invited_by)
       VALUES ($1, $2, $3, now() + $4::interval, $5)
       ON CONFLICT (email) WHERE used_at IS NULL AND revoked_at IS NULL DO NOTHING
       RETURNING id::text, expires_at`,
      [email, input.role, hash, INVITE_TTL, actor.id],
    );
    const row = rows[0];
    if (!row) return { ok: false as const, code: 'already_invited' as const };
    await insertAudit(c, actor, {
      action: 'staff.invite',
      entityType: 'staff_invitation',
      entityId: row.id,
      after: { email, role: input.role, expires_at: row.expires_at },
    });
    return { ok: true as const, id: row.id };
  });
  if (!created.ok) return created;

  const emailSent = await deliverInvite(deps, { id: created.id, email, role: input.role }, token, actor);
  return { ok: true, id: created.id, emailSent };
}

/** "Gửi lại": a new token and a fresh 7 days; the old link stops working. Revives an expired invitation. */
export async function resendInvitation(
  deps: StaffDeps,
  actor: AuditActor,
  id: string,
): Promise<{ ok: true; emailSent: boolean } | Fail<'not_found'>> {
  const { token, hash } = newInviteToken();
  const updated = await withTransaction(deps.pool, async (c) => {
    const { rows } = await c.query<{ email: string; role: StaffRole; expires_at: Date }>(
      `UPDATE staff_invitation
          SET token_hash = $2, expires_at = now() + $3::interval
        WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL
        RETURNING email, role, expires_at`,
      [id, hash, INVITE_TTL],
    );
    const row = rows[0];
    if (!row) return null;
    await insertAudit(c, actor, {
      action: 'staff.invite_resend',
      entityType: 'staff_invitation',
      entityId: id,
      after: { email: row.email, role: row.role, expires_at: row.expires_at },
    });
    return row;
  });
  if (!updated) return { ok: false, code: 'not_found' };
  return { ok: true, emailSent: await deliverInvite(deps, { id, email: updated.email, role: updated.role }, token, actor) };
}

export async function revokeInvitation(
  deps: StaffDeps,
  actor: AuditActor,
  id: string,
): Promise<{ ok: true } | Fail<'not_found'>> {
  return withTransaction(deps.pool, async (c) => {
    const { rows } = await c.query<{ email: string; role: StaffRole }>(
      `UPDATE staff_invitation SET revoked_at = now()
        WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL
        RETURNING email, role`,
      [id],
    );
    if (!rows[0]) return { ok: false as const, code: 'not_found' as const };
    await insertAudit(c, actor, {
      action: 'staff.invite_revoke',
      entityType: 'staff_invitation',
      entityId: id,
      before: rows[0],
    });
    return { ok: true as const };
  });
}

/** The invitation a token opens, for the accept page. Never says why a token is bad. */
export async function findOpenInvitation(
  pool: Pool,
  token: string,
): Promise<{ id: string; email: string; role: StaffRole } | null> {
  if (!TOKEN_RE.test(token)) return null;
  const { rows } = await pool.query<{ id: string; email: string; role: StaffRole }>(
    `SELECT id::text, email, role FROM staff_invitation
      WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

/**
 * Creates the account (auth.api.createUser without headers: a trusted server
 * call, and the invitation gate in databaseHooks checks again), then marks the
 * invitation used together with its audit row. The caller signs the new member
 * in. Two racing accepts of one token: the unique email lets one createUser
 * through. If the "mark used" write fails after createUser, the link answers
 * already_staff from then on and closes the invitation, and removeStaff closes
 * it too, so it can never recreate a removed account.
 */
export async function acceptInvitation(
  deps: StaffDeps,
  input: { token: string; name: string; password: string },
  ip: string | null = null,
): Promise<{ ok: true; userId: string; email: string } | Fail<'invalid_token' | 'already_staff'>> {
  const invitation = await findOpenInvitation(deps.pool, input.token);
  if (!invitation) return { ok: false, code: 'invalid_token' };

  let user: { id: string; email: string };
  try {
    ({ user } = await deps.auth.api.createUser({
      // Opening the emailed link proves the address.
      body: {
        email: invitation.email,
        password: input.password,
        name: input.name,
        role: invitation.role,
        data: { emailVerified: true },
      },
    }));
  } catch (err) {
    if (isAPIError(err) && err.body?.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') {
      // The account exists, so this invitation is spent. (A racing winner's own
      // UPDATE then matches no row; it still writes its audit row.)
      await deps.pool.query(
        'UPDATE staff_invitation SET used_at = now() WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL',
        [invitation.id],
      );
      return { ok: false, code: 'already_staff' };
    }
    // Revoked or expired between the lookup and the insert.
    if (isAPIError(err) && err.body?.code === INVITATION_REQUIRED) return { ok: false, code: 'invalid_token' };
    throw err;
  }

  await withTransaction(deps.pool, async (c) => {
    // A revoke can land after createUser's check; marking a revoked row used would
    // violate staff_invitation_closed_once and roll back the audit row, so skip it.
    await c.query(
      'UPDATE staff_invitation SET used_at = now() WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL',
      [invitation.id],
    );
    await insertAudit(
      c,
      { id: user.id, email: user.email, ip },
      {
        action: 'staff.invite_accept',
        entityType: 'staff_user',
        entityId: user.id,
        after: { email: invitation.email, role: invitation.role, invitation_id: invitation.id },
      },
    );
  });
  return { ok: true, userId: user.id, email: invitation.email };
}

/**
 * Locks every Admin row, always in id order, so two concurrent demotions, bans
 * or removals cannot both see "another Admin remains". Every function below
 * takes this lock first, then the target row.
 */
async function lockAdmins(c: PoolClient): Promise<void> {
  await c.query(`SELECT id FROM staff_user WHERE role = 'admin' ORDER BY id FOR UPDATE`);
}

/** Admins other than `userId` who can still sign in. */
async function otherActiveAdmins(c: PoolClient, userId: string): Promise<number> {
  const { rows } = await c.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM staff_user WHERE role = 'admin' AND id <> $1 AND banned IS NOT TRUE`,
    [userId],
  );
  return rows[0]?.n ?? 0;
}

type Target = { id: string; email: string; name: string; role: StaffRole; banned: boolean | null };

async function lockTarget(c: PoolClient, userId: string): Promise<Target | undefined> {
  await lockAdmins(c);
  const { rows } = await c.query<Target>(
    'SELECT id, email, name, role, banned FROM staff_user WHERE id = $1 FOR UPDATE',
    [userId],
  );
  return rows[0];
}

const isLastAdmin = async (c: PoolClient, target: Target) =>
  target.role === 'admin' && (await otherActiveAdmins(c, target.id)) === 0;

export async function setStaffRole(
  pool: Pool,
  actor: AuditActor,
  input: { userId: string; role: StaffRole },
): Promise<{ ok: true; changed: boolean } | Fail<'not_found' | 'last_admin'>> {
  return withTransaction(pool, async (c) => {
    const target = await lockTarget(c, input.userId);
    if (!target) return { ok: false as const, code: 'not_found' as const };
    if (target.role === input.role) return { ok: true as const, changed: false };
    if (await isLastAdmin(c, target)) return { ok: false as const, code: 'last_admin' as const };
    // The write auth.api.setRole makes; the next getSession reads it (no cookie cache).
    await c.query('UPDATE staff_user SET role = $2, updated_at = now() WHERE id = $1', [target.id, input.role]);
    await insertAudit(c, actor, {
      action: 'staff.role',
      entityType: 'staff_user',
      entityId: target.id,
      before: { role: target.role },
      after: { role: input.role },
    });
    return { ok: true as const, changed: true };
  });
}

/** "Khóa": the member can no longer sign in, and every session they hold ends now. */
export async function banStaff(
  pool: Pool,
  actor: AuditActor,
  userId: string,
): Promise<{ ok: true; changed: boolean } | Fail<'not_found' | 'last_admin' | 'self'>> {
  if (userId === actor.id) return { ok: false, code: 'self' };
  return withTransaction(pool, async (c) => {
    const target = await lockTarget(c, userId);
    if (!target) return { ok: false as const, code: 'not_found' as const };
    if (target.banned) return { ok: true as const, changed: false };
    if (await isLastAdmin(c, target)) return { ok: false as const, code: 'last_admin' as const };
    // The writes auth.api.banUser makes: getSession does not re-check `banned`, so the sessions must go.
    await c.query('UPDATE staff_user SET banned = true, updated_at = now() WHERE id = $1', [target.id]);
    await c.query('DELETE FROM staff_session WHERE user_id = $1', [target.id]);
    await insertAudit(c, actor, {
      action: 'staff.ban',
      entityType: 'staff_user',
      entityId: target.id,
      before: { banned: false },
      after: { banned: true },
    });
    return { ok: true as const, changed: true };
  });
}

/** "Mở khóa". */
export async function unbanStaff(
  pool: Pool,
  actor: AuditActor,
  userId: string,
): Promise<{ ok: true; changed: boolean } | Fail<'not_found'>> {
  return withTransaction(pool, async (c) => {
    const target = await lockTarget(c, userId);
    if (!target) return { ok: false as const, code: 'not_found' as const };
    if (!target.banned) return { ok: true as const, changed: false };
    await c.query(
      'UPDATE staff_user SET banned = false, ban_reason = NULL, ban_expires = NULL, updated_at = now() WHERE id = $1',
      [target.id],
    );
    await insertAudit(c, actor, {
      action: 'staff.unban',
      entityType: 'staff_user',
      entityId: target.id,
      before: { banned: true },
      after: { banned: false },
    });
    return { ok: true as const, changed: true };
  });
}

export async function removeStaff(
  pool: Pool,
  actor: AuditActor,
  userId: string,
): Promise<{ ok: true } | Fail<'not_found' | 'last_admin' | 'self'>> {
  if (userId === actor.id) return { ok: false, code: 'self' };
  return withTransaction(pool, async (c) => {
    const target = await lockTarget(c, userId);
    if (!target) return { ok: false as const, code: 'not_found' as const };
    if (await isLastAdmin(c, target)) return { ok: false as const, code: 'last_admin' as const };
    // An invitation still open for this address (its "mark used" write failed)
    // would let the old link recreate the account; the address needs a new invitation.
    await c.query(
      `UPDATE staff_invitation SET revoked_at = now()
        WHERE email = $1 AND used_at IS NULL AND revoked_at IS NULL`,
      [target.email],
    );
    // Sessions and accounts go with it (ON DELETE CASCADE), as in auth.api.removeUser.
    await c.query('DELETE FROM staff_user WHERE id = $1', [target.id]);
    await insertAudit(c, actor, {
      action: 'staff.remove',
      entityType: 'staff_user',
      entityId: target.id,
      before: { email: target.email, name: target.name, role: target.role },
    });
    return { ok: true as const };
  });
}
