import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { listOpenInvitations, listStaff } from '@/lib/server/auth/staff-queries';
import { TEST_DATABASE_URL } from '../helpers/db';
import { STAFF_TABLES, createBootstrapAdmin, createStaffUser, createTestAuth } from '../helpers/auth';

/* What /admin/users and the overview read (spec §7.2). */

let pool: Pool;

const invite = (email: string, set = '') =>
  pool.query(
    `INSERT INTO staff_invitation (email, role, token_hash, expires_at, created_at)
     VALUES ($1, 'editor', md5($1) || md5($1), now() + interval '7 days', now() - (SELECT count(*) FROM staff_invitation) * interval '1 minute')`,
    [email],
  ).then(() => (set ? pool.query(`UPDATE staff_invitation SET ${set} WHERE email = $1`, [email]) : undefined));

describe.skipIf(!TEST_DATABASE_URL)('staff queries', () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query(`TRUNCATE ${STAFF_TABLES} CASCADE`);
  });

  it('lists staff oldest first, with role and ban', async () => {
    const auth = createTestAuth(pool);
    const owner = await createBootstrapAdmin(auth);
    const ed = await createStaffUser(auth, pool, 'ed@furama.test', 'editor');
    await pool.query('UPDATE staff_user SET banned = true WHERE id = $1', [ed.id]);
    const staff = await listStaff(pool);
    expect(staff.map(({ id, email, role, banned }) => ({ id, email, role, banned }))).toEqual([
      { id: owner.id, email: owner.email, role: 'admin', banned: false },
      { id: ed.id, email: 'ed@furama.test', role: 'editor', banned: true },
    ]);
    expect(staff[0].created_at).toBeInstanceOf(Date);
  });

  it('lists open invitations newest first, says which expired, and shows the last email error', async () => {
    await invite('open@furama.test');
    await invite('expired@furama.test', `expires_at = now() - interval '1 second'`);
    await invite('failed@furama.test', `email_error = 'provider_error: Resend rejected the email: rate limited'`);
    await invite('used@furama.test', 'used_at = now()');
    await invite('revoked@furama.test', 'revoked_at = now()');
    const open = await listOpenInvitations(pool);
    expect(open.map(({ email, expired, email_error }) => ({ email, expired, email_error }))).toEqual([
      { email: 'open@furama.test', expired: false, email_error: null },
      { email: 'expired@furama.test', expired: true, email_error: null },
      { email: 'failed@furama.test', expired: false, email_error: 'provider_error: Resend rejected the email: rate limited' },
    ]);
    expect(open[0].id).toMatch(/^\d+$/);
  });
});
