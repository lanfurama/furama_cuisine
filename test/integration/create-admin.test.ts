import { spawnSync } from 'node:child_process';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL } from '../helpers/db';
import { STAFF_TABLES, TEST_SECRET } from '../helpers/auth';

/*
 * scripts/create-admin.mjs, run the way an operator runs it: a separate node
 * process with an explicit environment (it reads no .env file).
 */

let pool: Pool;

/** `undefined` leaves a variable out; `input` is what stdin holds before it closes. */
function run(env: Record<string, string | undefined>, input = '') {
  const result = spawnSync(process.execPath, ['scripts/create-admin.mjs'], {
    encoding: 'utf8',
    input,
    env: {
      // What node, jiti's cache and pg's default user need; nothing else leaks in.
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      USER: process.env.USER ?? '',
      TMPDIR: process.env.TMPDIR ?? '',
      // As strict as it gets: Better Auth refuses weak setups in production.
      NODE_ENV: 'production',
      DATABASE_URL: TEST_DATABASE_URL ?? '',
      BETTER_AUTH_SECRET: TEST_SECRET,
      BETTER_AUTH_URL: 'http://localhost:3000',
      BOOTSTRAP_ADMIN_NAME: 'Chủ quán',
      BOOTSTRAP_ADMIN_PASSWORD: 'correct horse battery',
      ...env,
    },
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

describe.skipIf(!TEST_DATABASE_URL)('scripts/create-admin.mjs', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    await pool.query(`TRUNCATE ${STAFF_TABLES} CASCADE`);
  });
  afterAll(async () => {
    await pool.query(`TRUNCATE ${STAFF_TABLES} CASCADE`);
    await pool.end();
  });

  it('creates the first Admin, verified, with a staff.bootstrap audit row', async () => {
    const { status, out } = run({ BOOTSTRAP_ADMIN_EMAIL: 'Owner@Furama.test' });
    expect(out).toContain('Admin created: owner@furama.test');
    expect(status).toBe(0);
    // Where it writes comes first, and carries no credentials.
    const target = new URL(TEST_DATABASE_URL!);
    expect(out.indexOf(`Target database: ${target.hostname}${target.port ? `:${target.port}` : ''}${target.pathname}\n`)).toBe(0);
    if (target.password) expect(out).not.toContain(`${target.username}:${target.password}@`);
    const { rows } = await pool.query(
      `SELECT u.name, u.role, u.email_verified, a.action, a.actor_id = u.id AS self
         FROM staff_user u JOIN audit_log a ON a.entity_id = u.id`,
    );
    expect(rows).toEqual([{ name: 'Chủ quán', role: 'admin', email_verified: true, action: 'staff.bootstrap', self: true }]);
  });

  it('refuses the same email again', () => {
    const { status, out } = run({ BOOTSTRAP_ADMIN_EMAIL: 'owner@furama.test' });
    expect(status).toBe(1);
    expect(out).toContain('refused: owner@furama.test already has an account.');
  });

  it('refuses a second Admin once one exists', async () => {
    const { status, out } = run({ BOOTSTRAP_ADMIN_EMAIL: 'second@furama.test' });
    expect(status).toBe(1);
    expect(out).toContain('refused: an Admin already exists, or the email is not BOOTSTRAP_ADMIN_EMAIL.');
    expect((await pool.query('SELECT count(*)::int AS n FROM staff_user')).rows[0].n).toBe(1);
  });

  it('refuses a password shorter than 12 characters before touching the database', () => {
    const { status, out } = run({ BOOTSTRAP_ADMIN_EMAIL: 'short@furama.test', BOOTSTRAP_ADMIN_PASSWORD: '11 chars ok' });
    expect(status).toBe(1);
    expect(out).toContain('The password must be 12–128 characters.');
    expect(out).not.toContain('Creating Admin');
  });

  it('prompts after naming the target, and stdin closing without a newline fails with the length message', () => {
    // No BOOTSTRAP_ADMIN_PASSWORD: the hidden prompt reads stdin, which closes at once (or mid-line).
    for (const input of ['', 'no newline here']) {
      const { status, out } = run({ BOOTSTRAP_ADMIN_EMAIL: 'eof@furama.test', BOOTSTRAP_ADMIN_PASSWORD: undefined }, input);
      expect(status).toBe(1);
      expect(out).toMatch(/^Target database: \S+\nPassword for eof@furama\.test: /);
      expect(out).toContain('The password must be 12–128 characters.');
      expect(out).not.toContain('Creating Admin');
    }
  });

  it('refuses to run without BETTER_AUTH_SECRET', () => {
    const { status, out } = run({ BOOTSTRAP_ADMIN_EMAIL: 'x@furama.test', BETTER_AUTH_SECRET: '' });
    expect(status).toBe(1);
    expect(out).toContain('BETTER_AUTH_SECRET is not set.');
  });

  it('when the audit row fails after the Admin was created, says so and prints SQL that adds it', async () => {
    await pool.query(`TRUNCATE ${STAFF_TABLES} CASCADE`);
    // Make that one INSERT fail, the way a dropped connection or a missing grant would.
    await pool.query(`CREATE FUNCTION refuse_bootstrap_audit() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'audit_log is read-only right now'; END $$`);
    await pool.query(`CREATE TRIGGER refuse_bootstrap BEFORE INSERT ON audit_log FOR EACH ROW
      WHEN (NEW.action = 'staff.bootstrap') EXECUTE FUNCTION refuse_bootstrap_audit()`);
    let result: ReturnType<typeof run>;
    try {
      result = run({ BOOTSTRAP_ADMIN_EMAIL: 'audit@furama.test' });
    } finally {
      await pool.query('DROP TRIGGER refuse_bootstrap ON audit_log');
      await pool.query('DROP FUNCTION refuse_bootstrap_audit()');
    }
    const { status, out } = result;
    expect(status).toBe(1);
    const { rows: users } = await pool.query<{ id: string }>(`SELECT id FROM staff_user WHERE email = 'audit@furama.test'`);
    expect(users).toHaveLength(1);
    expect(out).toContain(`the Admin audit@furama.test (${users[0].id}) was created on `);
    expect(out).toContain('but its staff.bootstrap audit row was not written:');
    expect(out).toContain('audit_log is read-only right now');
    expect(out).not.toContain('Admin created:');
    expect((await pool.query('SELECT count(*)::int AS n FROM audit_log')).rows[0].n).toBe(0);

    // The printed statement, run as is, writes the row the script would have written.
    const sql = /^ {2}(INSERT INTO audit_log .*;)$/m.exec(out)?.[1];
    expect(sql).toBeDefined();
    await pool.query(sql!);
    const { rows } = await pool.query(
      `SELECT a.action, a.entity_type, a.actor_id = u.id AS self, a.actor_email, a.after
         FROM staff_user u JOIN audit_log a ON a.entity_id = u.id`,
    );
    expect(rows).toEqual([
      { action: 'staff.bootstrap', entity_type: 'staff_user', self: true, actor_email: 'audit@furama.test', after: { email: 'audit@furama.test', role: 'admin' } },
    ]);
  });
});
