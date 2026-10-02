import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, databaseUrl, migrate, resetDatabase, withClient } from '../helpers/db';

const url = databaseUrl('furama_cuisine_migrate005_test');
const sql = (text: string, values: unknown[] = []) => withClient(url, (c) => c.query(text, values));

const HASH = 'a'.repeat(64);
const invite = (email: string, hash = HASH, extra = '') =>
  sql(
    `INSERT INTO staff_invitation (email, role, token_hash, expires_at${extra ? ', used_at, revoked_at' : ''})
     VALUES ($1, 'editor', $2, now() + interval '7 days'${extra})`,
    [email, hash],
  );

describe.skipIf(!TEST_DATABASE_URL)('migration 005: staff sign-in and the audit trail (database)', () => {
  // Migration 005 on its own: 006 owns audit_feed from then on, and re-running
  // 005 on top of 006 would drop the view's reservation branch.
  beforeAll(() => resetDatabase(url, '005_staff_auth_audit.sql'));

  it('creates the seven tables and the audit_feed view', async () => {
    const { rows } = await sql(
      `SELECT table_name, table_type FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('staff_user', 'staff_session', 'staff_account', 'staff_verification',
                             'auth_rate_limit', 'staff_invitation', 'audit_log', 'audit_feed')
        ORDER BY table_name`,
    );
    expect(rows).toEqual([
      { table_name: 'audit_feed', table_type: 'VIEW' },
      { table_name: 'audit_log', table_type: 'BASE TABLE' },
      { table_name: 'auth_rate_limit', table_type: 'BASE TABLE' },
      { table_name: 'staff_account', table_type: 'BASE TABLE' },
      { table_name: 'staff_invitation', table_type: 'BASE TABLE' },
      { table_name: 'staff_session', table_type: 'BASE TABLE' },
      { table_name: 'staff_user', table_type: 'BASE TABLE' },
      { table_name: 'staff_verification', table_type: 'BASE TABLE' },
    ]);
  });

  it('allows only the admin and editor roles', async () => {
    await sql(
      `INSERT INTO staff_user (id, name, email, email_verified, role) VALUES ('u1', 'A', 'a@furama.test', true, 'admin')`,
    );
    await expect(
      sql(`INSERT INTO staff_user (id, name, email, email_verified, role) VALUES ('u2', 'O', 'o@furama.test', true, 'owner')`),
    ).rejects.toThrow(/staff_user_role_check/);
  });

  it('checks invitation emails, token hashes and closing', async () => {
    await expect(invite('Upper@furama.test')).rejects.toThrow(/staff_invitation_email_check/);
    await expect(invite('x@furama.test', 'not-a-hash')).rejects.toThrow(/staff_invitation_token_hash_check/);
    await expect(invite('y@furama.test', 'b'.repeat(64), ', now(), now()')).rejects.toThrow(/staff_invitation_closed_once/);
  });

  it('holds one open invitation per email; a revoked one frees the email', async () => {
    await invite('ed@furama.test', 'c'.repeat(64));
    await expect(invite('ed@furama.test', 'd'.repeat(64))).rejects.toThrow(/staff_invitation_open_email_idx/);
    await sql(`UPDATE staff_invitation SET revoked_at = now() WHERE email = 'ed@furama.test'`);
    await invite('ed@furama.test', 'd'.repeat(64));
    expect((await sql(`SELECT count(*)::int AS n FROM staff_invitation WHERE email = 'ed@furama.test'`)).rows[0].n).toBe(2);
  });

  it('accepts staff.* and the content actions in audit_log, nothing else', async () => {
    const insert = (action: string) =>
      sql(`INSERT INTO audit_log (action, entity_type, entity_id) VALUES ($1, 'staff_user', 'u1')`, [action]);
    await insert('staff.role');
    await insert('update');
    await expect(insert('login')).rejects.toThrow(/audit_log_action_check/);
    await expect(insert('staff.')).rejects.toThrow(/audit_log_action_check/);
    await expect(
      sql(`INSERT INTO audit_log (action, entity_type) VALUES ('update', '')`),
    ).rejects.toThrow(/audit_log_entity_type_check/);
  });

  it('exposes audit_log through audit_feed with the columns phase 4 will keep', async () => {
    const { rows } = await sql(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'audit_feed' ORDER BY ordinal_position`,
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      'source',
      'id',
      'at',
      'actor_id',
      'actor_label',
      'action',
      'entity_type',
      'entity_id',
      'locale',
      'before',
      'after',
    ]);
    const feed = await sql(`SELECT source, action FROM audit_feed WHERE action = 'staff.role'`);
    expect(feed.rows).toEqual([{ source: 'audit', action: 'staff.role' }]);
  });

  it('is safe to apply again', async () => {
    await sql(readFileSync('db/migrations/005_staff_auth_audit.sql', 'utf8'));
    expect((await sql('SELECT count(*)::int AS n FROM staff_user')).rows[0].n).toBe(1);
    expect((await sql('SELECT count(*)::int AS n FROM audit_log')).rows[0].n).toBe(2);
  });

  it('applies on top of a database that already has bookings and content', async () => {
    resetDatabase(url, '004_foundations_locales_strings_destinations.sql');
    await sql(
      `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, phone_e164)
       VALUES ('FC-99998', 'taya-house', '2026-10-05', '19:00', 2, 'Guest', '0905 000 000', '+84905000000')`,
    );
    migrate(url);
    expect((await sql(`SELECT count(*)::int AS n FROM reservations WHERE reference = 'FC-99998'`)).rows[0].n).toBe(1);
    expect((await sql('SELECT count(*)::int AS n FROM staff_user')).rows[0].n).toBe(0);
  });
});
