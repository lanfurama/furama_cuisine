import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, databaseUrl, migrate, resetDatabase, withClient } from '../helpers/db';

/*
 * Migration 011 (phase 9): the AI settings row, glossary, usage ledger and
 * bulk-translation jobs. The upgrade from 010, a re-run of the file, and the
 * runbook's Neon checks (db/checks/*-011.sql) on the same database.
 */

const url = databaseUrl('furama_cuisine_migrate011_test');
const FILE = 'db/migrations/011_ai_phase9.sql';
const sql = (text: string, values: unknown[] = []) => withClient(url, (c) => c.query(text, values));
/** A psql file of several statements: pg answers with one result per statement, or one result for one. */
const checks = async (file: string) => {
  const res = (await sql(readFileSync(file, 'utf8'))) as unknown;
  return (Array.isArray(res) ? res.flatMap((r) => r.rows) : (res as { rows: unknown[] }).rows) as { check: string; ok: boolean; detail: string | null }[];
};

describe.skipIf(!TEST_DATABASE_URL)('migration 011: AI (database)', () => {
  beforeAll(async () => {
    resetDatabase(url, '010_locales_phase8.sql');
  });

  it('passes the runbook pre-flight at 010, then the post-check', async () => {
    expect((await checks('db/checks/preflight-011.sql')).filter((r) => !r.ok)).toEqual([]);
    migrate(url);
    expect((await checks('db/checks/postcheck-011.sql')).filter((r) => !r.ok)).toEqual([]);
  });

  it('keeps one live job per language', async () => {
    await withClient(url, async (c) => {
      await c.query(`INSERT INTO ai_jobs (locale, scope, created_by) VALUES ('vi', '{}', NULL)`);
      await expect(c.query(`INSERT INTO ai_jobs (locale, scope, created_by) VALUES ('vi', '{}', NULL)`)).rejects.toThrow(/ai_jobs_one_live_idx/);
      await c.query(`UPDATE ai_jobs SET status = 'done' WHERE locale = 'vi'`);
      await c.query(`INSERT INTO ai_jobs (locale, scope, created_by) VALUES ('vi', '{}', NULL)`); // a finished job does not block
    });
  });

  it('refuses a second settings row and a bad glossary mode', async () => {
    await withClient(url, async (c) => {
      await expect(c.query(`INSERT INTO ai_settings (id, data) VALUES (2, '{}')`)).rejects.toThrow();
      await expect(c.query(`INSERT INTO ai_glossary (term, mode) VALUES ('x', 'translate')`)).rejects.toThrow();
      await expect(c.query(`INSERT INTO ai_glossary (term, mode, locale) VALUES ('Da Nang', 'map', 'vi')`)).rejects.toThrow(/target/);
    });
  });

  it('seeds the default settings row once', async () => {
    await withClient(url, async (c) => {
      const { rows } = await c.query(`SELECT data FROM ai_settings`);
      expect(rows).toHaveLength(1);
      expect(rows[0].data).toEqual({}); // defaults live in code (D2); {} parses to them
    });
  });

  it('re-runs without adding a settings row, and the post-check stays green', async () => {
    await sql(readFileSync(FILE, 'utf8'));
    expect((await sql(`SELECT count(*)::int AS n FROM ai_settings`)).rows[0]).toEqual({ n: 1 });
    migrate(url);
    expect((await checks('db/checks/postcheck-011.sql')).filter((r) => !r.ok)).toEqual([]);
  });
});
