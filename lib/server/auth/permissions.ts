import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements } from 'better-auth/plugins/admin/access';

/*
 * The permission matrix of spec §7.1. `user` and `session` are the admin
 * plugin's own resources (its auth.api.* endpoints check them); the rest are
 * ours. defaultStatements also lists user:impersonate, impersonate-admins and
 * set-email, which no role gets (spec §7.1).
 *
 * No server-only import: the schema CLI (scripts/auth-cli.config.ts), the
 * bootstrap script and the admin nav load this file too.
 */
export const statement = {
  ...defaultStatements,
  /** Content, files and translations; `ai` = use the AI helpers; `restore` = history (§7.5). */
  content: ['read', 'update', 'restore', 'ai'],
  /** Handle, create and annotate bookings; `configure` = per-restaurant booking switch and overrides. */
  reservations: ['read', 'update', 'create', 'note', 'configure', 'auto-confirm', 'purge-test'],
  /** Service periods, capacity and closures. */
  schedule: ['read', 'update'],
  locales: ['read', 'update'],
  /** Booking, notification and AI settings. */
  settings: ['read', 'update'],
  /** The site-wide audit log (/admin/audit). Per-record history is content:read. */
  audit: ['read'],
} as const;

export const ac = createAccessControl(statement);

const editorStatements = {
  content: ['read', 'update', 'restore', 'ai'],
  reservations: ['read', 'update', 'create', 'note', 'configure'],
  schedule: ['read', 'update'],
} as const;

export const editor = ac.newRole(editorStatements);

export const admin = ac.newRole({
  ...editorStatements,
  reservations: [...editorStatements.reservations, 'auto-confirm', 'purge-test'],
  locales: ['read', 'update'],
  settings: ['read', 'update'],
  audit: ['read'],
  user: ['create', 'list', 'get', 'update', 'set-role', 'ban', 'delete', 'set-password'],
  session: ['list', 'revoke', 'delete'],
});

export const roles = { admin, editor };

export const STAFF_ROLES = ['admin', 'editor'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(value: unknown): value is StaffRole {
  return value === 'admin' || value === 'editor';
}

type Statement = typeof statement;
/** e.g. `{ user: ['set-role'] }`, the shape auth.api.userHasPermission takes. */
export type Permissions = { [K in keyof Statement]?: Statement[K][number][] };

/**
 * The admin plugin's rule (comma-separated roles; a role that grants every
 * requested action wins) without a database call.
 */
export function roleCan(role: string | null | undefined, permissions: Permissions): boolean {
  if (!role) return false;
  return role.split(',').some((r) => {
    const grant = isStaffRole(r) ? roles[r] : undefined;
    return grant?.authorize(permissions).success === true;
  });
}
