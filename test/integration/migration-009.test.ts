import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { REGISTRY } from '@/lib/i18n/registry';
import { AGREED_KEYS, PRIVACY_POLICY_VERSION } from '@/lib/legal';
import { TEST_DATABASE_URL, databaseUrl, migrate, resetDatabase, withClient } from '../helpers/db';

/*
 * Migration 009 (phase 7): legal_versions, the privacy policy's versions,
 * append-only (R21). The upgrade from 008 with a booking that already stored
 * the phase-5 version, a re-run of the file, the CHECKs, and the runbook's
 * Neon checks (db/checks/*-009.sql) on the same database.
 */

const url = databaseUrl('furama_cuisine_migrate009_test');
const FILE = 'db/migrations/009_legal_versions.sql';
const SEED_HASH = 'f49aa3f58723d14d6491c1801466c411fe9439acab85b4da5272d4c7676e10d2';
const sql = (text: string, values: unknown[] = []) => withClient(url, (c) => c.query(text, values));
const one = async (text: string, values: unknown[] = []) => (await sql(text, values)).rows[0];
/** A psql file of several statements: pg answers with one result per statement, or one result for one. */
const checks = async (file: string) => {
  const res = (await sql(readFileSync(file, 'utf8'))) as unknown;
  return (Array.isArray(res) ? res.flatMap((r) => r.rows) : (res as { rows: unknown[] }).rows) as { check: string; ok: boolean; detail: string | null }[];
};

describe.skipIf(!TEST_DATABASE_URL)('migration 009: legal_versions (database)', () => {
  beforeAll(async () => {
    resetDatabase(url, '008_content.sql');
    await sql(
      `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source, consent_version, consented_at)
       VALUES ('FC-PRE00009', 'taya-house', '2026-10-06', '19:00', 'Dinner', 2, 'G', '0905 111 111', '+84905111111', 'web', $1, now())`,
      [PRIVACY_POLICY_VERSION],
    );
  });

  it('passes the runbook pre-flight at 008, then adds the table seeded with the phase-5 policy, and the post-check', async () => {
    expect((await checks('db/checks/preflight-009.sql')).filter((r) => !r.ok)).toEqual([]);
    migrate(url);
    expect((await sql(`SELECT version, to_char(effective_on, 'YYYY-MM-DD') AS on, text_sha256, created_by FROM legal_versions`)).rows).toEqual([
      { version: '2026-10-03', on: '2026-10-03', text_sha256: SEED_HASH, created_by: 'seed' },
    ]);
    expect((await checks('db/checks/postcheck-009.sql')).filter((r) => !r.ok)).toEqual([]);
    // The booking keeps the version it stored, which is the seeded row's.
    expect(await one(`SELECT consent_version FROM reservations`)).toEqual({ consent_version: PRIVACY_POLICY_VERSION });
  });

  // This pins 009's seed to today's code defaults of the agreed text. If a default changes, do not edit
  // 009 or its seed (a migration runs once per database, and the seed is the first version): add a new
  // migration that inserts a legal_versions row for the new text (today's Da Nang date, the new hash),
  // shipped in the same deploy window as the code, and move this registry check to that migration's
  // test; here, keep only the seed's own SEED_HASH.
  it('seeds the hash of the registry’s agreed English text, as the version check computes it', () => {
    const text = JSON.stringify(AGREED_KEYS.map((k) => [k, REGISTRY[k].en]));
    expect(createHash('sha256').update(text).digest('hex')).toBe(SEED_HASH);
  });

  it('re-runs without adding a row', async () => {
    await sql(readFileSync(FILE, 'utf8'));
    expect(await one(`SELECT count(*)::int AS n FROM legal_versions`)).toEqual({ n: 1 });
  });

  it('accepts a Da Nang date with an optional .n, and a sha256; refuses anything else', async () => {
    const add = (version: string, sha = SEED_HASH) =>
      sql(`INSERT INTO legal_versions (version, effective_on, text_sha256) VALUES ($1, DATE '2026-10-05', $2)`, [version, sha]);
    await expect(add('2026-10-05')).resolves.toBeDefined();
    await expect(add('2026-10-05.2')).resolves.toBeDefined();
    await expect(add('v2')).rejects.toThrow(/legal_versions_version_check/);
    await expect(add('2026-10-05.1234')).rejects.toThrow(/legal_versions_version_check/);
    await expect(add('2026-10-06', 'abc')).rejects.toThrow(/legal_versions_text_sha256_check/);
    await expect(add('2026-10-05')).rejects.toThrow(/legal_versions_pkey/);
  });
});
