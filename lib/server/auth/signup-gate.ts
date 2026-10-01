import type { StaffRole } from './permissions';

/** Anything with pg's `query` (a Pool or a checked-out client). */
export type Queryable = {
  query<R extends Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
};

export type SignupDecision =
  | { ok: true; role: StaffRole; via: 'invitation' | 'bootstrap' }
  | { ok: false };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Who may get a staff_user row (spec §7.1): an email with an open invitation
 * (not used, not revoked, not expired) takes the invitation's role; the
 * BOOTSTRAP_ADMIN_EMAIL becomes Admin, but only while no Admin exists.
 * Everyone else is refused. Runs inside databaseHooks.user.create.before, so
 * every path that creates a user (admin createUser, the bootstrap script, a
 * future plugin) goes through it.
 */
export async function decideSignup(
  db: Queryable,
  email: string,
  bootstrapAdminEmail: string | undefined,
): Promise<SignupDecision> {
  const normalized = normalizeEmail(email);
  const { rows } = await db.query<{ role: StaffRole }>(
    `SELECT role FROM staff_invitation
      WHERE email = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC
      LIMIT 1`,
    [normalized],
  );
  if (rows[0]) return { ok: true, role: rows[0].role, via: 'invitation' };

  if (bootstrapAdminEmail && normalized === normalizeEmail(bootstrapAdminEmail)) {
    const admins = await db.query(
      `SELECT 1 FROM staff_user WHERE 'admin' = ANY (string_to_array(role, ',')) LIMIT 1`,
    );
    if (admins.rows.length === 0) return { ok: true, role: 'admin', via: 'bootstrap' };
  }
  return { ok: false };
}
