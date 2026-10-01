import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { ADMIN_SIGN_IN } from '@/lib/admin/paths';
import type { AuditActor } from '@/lib/server/audit';
import { getAuth } from '@/lib/server/auth/auth';
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
  /** For audit_log.ip: the first X-Forwarded-For address (Vercel sets one, the client's). */
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
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;
  const { user } = session;
  if (user.banned || !isStaffRole(user.role)) return null;
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    ip: requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
  };
});

/** Pages: the staff member, or a redirect to sign-in. */
export async function verifySession(): Promise<StaffSession> {
  const staff = await getStaffSession();
  if (!staff) redirect(ADMIN_SIGN_IN);
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

/** Who did it, for insertAudit and the invitation email. */
export function auditActor(staff: StaffSession): AuditActor {
  return { id: staff.userId, email: staff.email, name: staff.name, ip: staff.ip };
}
