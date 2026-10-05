import 'server-only';
import { getSessionCookie } from 'better-auth/cookies';
import { headers } from 'next/headers';
import { forbidden, redirect } from 'next/navigation';
import { cache } from 'react';
import { ADMIN_SIGN_IN } from '@/lib/admin/paths';
import type { AuditActor } from '@/lib/server/audit';
import { getAuth } from '@/lib/server/auth/auth';
import { clientIp } from '@/lib/server/client-ip';
import { isStaffRole, roleCan, type Permissions, type StaffRole } from '@/lib/server/auth/permissions';

/*
 * The admin's data access layer (spec §4 dal/, §7.1 "Bảo vệ theo lớp";
 * node_modules/next/dist/docs/01-app/02-guides/authentication.md, "Creating a
 * Data Access Layer"). Every read goes to the database: the cookie cache is
 * off, so a role change, a ban or a removal applies on the next request.
 */

export type StaffSession = {
  userId: string;
  email: string;
  name: string;
  role: StaffRole;
  /** For audit_log.ip: see clientIp(). */
  ip: string | null;
};

export class PermissionError extends Error {
  constructor(readonly code: 'unauthenticated' | 'forbidden') {
    super(code);
    this.name = 'PermissionError';
  }
}

/** The signed-in staff member, or null. One lookup per request (React cache). */
export const getStaffSession = cache(async (): Promise<StaffSession | null> => {
  // headers() before anything else: `next build` runs admin pages up to their
  // first request-time call, and getAuth() before it would build Better Auth
  // (and the pool) at build time.
  const requestHeaders = await headers();
  // No session cookie, no session: answer without Better Auth. Anonymous and bot
  // hits on /admin/sign-in (the proxy lets them through) then neither build Better
  // Auth nor run its first-use schema check against the database on a cold start.
  // Same helper and cookie names as proxy.ts. A cookie that is present is still
  // checked against the database below.
  if (!getSessionCookie(requestHeaders)) return null;
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;
  const { user } = session;
  if (user.banned || !isStaffRole(user.role)) return null;
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    ip: clientIp(requestHeaders),
  };
});

/** Pages: the staff member, or a redirect to sign-in. */
export async function verifySession(): Promise<StaffSession> {
  const staff = await getStaffSession();
  if (!staff) redirect(ADMIN_SIGN_IN);
  return staff;
}

/**
 * Pages for some roles only: the staff member, or the 403 view of the nearest
 * forbidden.tsx (app/admin/(shell)/forbidden.tsx), with the URL kept. Under
 * Cache Components the response status stays 200 on next start (the shell's
 * status is sent before the render resumes); the page body still carries no data.
 */
export async function requirePagePermission(permissions: Permissions): Promise<StaffSession> {
  const staff = await verifySession();
  if (!roleCan(staff.role, permissions)) forbidden();
  return staff;
}

/**
 * Server Actions and route handlers, as their first statement: the staff
 * member if their role grants every requested action, else a PermissionError
 * that actionError() turns into `{ ok: false, code: 'forbidden' }`.
 */
export async function requirePermission(permissions: Permissions): Promise<StaffSession> {
  const staff = await getStaffSession();
  if (!staff) throw new PermissionError('unauthenticated');
  if (!roleCan(staff.role, permissions)) throw new PermissionError('forbidden');
  return staff;
}

/**
 * The catch of a void Server Action (a plain form post with no state to
 * answer in, like the inbox search): a lapsed session goes to sign-in and
 * back to `next`, a role without the permission gets the 403 view, as for a
 * page; anything else rethrows. Without it the PermissionError reached the
 * generic error page (phase-5 ledger T12.4).
 */
export function refuseVoidAction(err: unknown, next: string): never {
  if (err instanceof PermissionError) {
    if (err.code === 'unauthenticated') redirect(`${ADMIN_SIGN_IN}?next=${encodeURIComponent(next)}`);
    forbidden();
  }
  throw err;
}

/** Who did it, for insertAudit and the invitation email. */
export function auditActor(staff: StaffSession): AuditActor {
  return { id: staff.userId, email: staff.email, name: staff.name, ip: staff.ip };
}
