import 'server-only';
import type { Pool } from 'pg';
import type { StaffRole } from './permissions';

/*
 * Reads for /admin/users and the overview. Callers check user:list first.
 * "Expired" is decided by the database clock, not by Date.now() in a render.
 */

export type StaffRow = { id: string; name: string; email: string; role: StaffRole; banned: boolean; created_at: Date };

export type OpenInvitationRow = {
  id: string;
  email: string;
  role: StaffRole;
  expires_at: Date;
  expired: boolean;
  /** The last delivery failure ("<code>: <message>"), or null once a send worked. */
  email_error: string | null;
};

export async function listStaff(pool: Pool): Promise<StaffRow[]> {
  const { rows } = await pool.query<StaffRow>(
    `SELECT id, name, email, role, banned IS TRUE AS banned, created_at FROM staff_user ORDER BY created_at, id`,
  );
  return rows;
}

/** Invitations not used and not revoked, newest first; expired ones too, so they can be sent again. */
export async function listOpenInvitations(pool: Pool): Promise<OpenInvitationRow[]> {
  const { rows } = await pool.query<OpenInvitationRow>(
    `SELECT id::text, email, role, expires_at, expires_at <= now() AS expired, email_error
       FROM staff_invitation
      WHERE used_at IS NULL AND revoked_at IS NULL
      ORDER BY created_at DESC, id DESC`,
  );
  return rows;
}
