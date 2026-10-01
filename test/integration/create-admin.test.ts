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

function run(env: Record<string, string>) {
  const result = spawnSync(process.execPath, ['scripts/create-admin.mjs'], {
    encoding: 'utf8',
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

  it('refuses to run without BETTER_AUTH_SECRET', () => {
    const { status, out } = run({ BOOTSTRAP_ADMIN_EMAIL: 'x@furama.test', BETTER_AUTH_SECRET: '' });
    expect(status).toBe(1);
    expect(out).toContain('BETTER_AUTH_SECRET is not set.');
  });
});
