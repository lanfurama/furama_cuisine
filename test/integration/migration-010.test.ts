import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { PRIVACY_POLICY_VERSION } from '@/lib/legal';
import { TEST_DATABASE_URL, databaseUrl, migrate, resetDatabase, withClient } from '../helpers/db';

/*
 * Migration 010 (phase 8): locales.script names a script this build has fonts
 * for, a language a social link names cannot be deleted (L8-6), and the
 * privacy policy is versioned per language (R8-7). The upgrade from 009 with a
 * booking that already stored a version, a re-run of the file, and the
 * runbook's Neon checks (db/checks/*-010.sql) on the same database.
 *
 * 010 must also keep phase-7 code working, since it reaches production before
 * phase-8 code: an insert into legal_versions without a locale (the old
 * recordPolicyVersion) and a booking with a consent version but no consent
 * locale (the old create.ts) both still succeed.
 */

const url = databaseUrl('furama_cuisine_migrate010_test');
const FILE = 'db/migrations/010_locales_phase8.sql';
const SEED_HASH = 'f49aa3f58723d14d6491c1801466c411fe9439acab85b4da5272d4c7676e10d2';
const sql = (text: string, values: unknown[] = []) => withClient(url, (c) => c.query(text, values));
const one = async (text: string, values: unknown[] = []) => (await sql(text, values)).rows[0];
/** A psql file of several statements: pg answers with one result per statement, or one result for one. */
const checks = async (file: string) => {
  const res = (await sql(readFileSync(file, 'utf8'))) as unknown;
  return (Array.isArray(res) ? res.flatMap((r) => r.rows) : (res as { rows: unknown[] }).rows) as { check: string; ok: boolean; detail: string | null }[];
};
/** One booking per reference; the phone follows the reference, so the dedupe index never joins two. */
const booking = (reference: string, consent: string | null) =>
  sql(
    `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source, consent_version, consented_at)
     VALUES ($1, 'taya-house', '2026-10-06', '19:00', 'Dinner', 2, 'G', '0905 111 ' || right($1, 3), '+84905111' || right($1, 3), 'web', $2::text,
             CASE WHEN $2::text IS NULL THEN NULL ELSE now() END)`,
    [reference, consent],
  );

describe.skipIf(!TEST_DATABASE_URL)('migration 010: languages (database)', () => {
  beforeAll(async () => {
    resetDatabase(url, '009_legal_versions.sql');
    await booking('FC-PRE00010', PRIVACY_POLICY_VERSION);
    await booking('FC-PRE00011', null);
  });

  it('passes the runbook pre-flight at 009, then the post-check', async () => {
    expect((await checks('db/checks/preflight-010.sql')).filter((r) => !r.ok)).toEqual([]);
    migrate(url);
    expect((await checks('db/checks/postcheck-010.sql')).filter((r) => !r.ok)).toEqual([]);
  });

  it('gives the bookings that agreed to a version the English wording, and leaves the others without one', async () => {
    expect((await sql(`SELECT reference, consent_locale FROM reservations ORDER BY reference`)).rows).toEqual([
      { reference: 'FC-PRE00010', consent_locale: 'en' },
      { reference: 'FC-PRE00011', consent_locale: null },
    ]);
  });

  it('keys the seeded policy version by English, and lets another language reuse a version name', async () => {
    expect((await sql(`SELECT locale, version, text_sha256 FROM legal_versions`)).rows).toEqual([
      { locale: 'en', version: '2026-10-03', text_sha256: SEED_HASH },
    ]);
    await sql(`INSERT INTO legal_versions (locale, version, effective_on, text_sha256) VALUES ('vi', '2026-10-03', DATE '2026-10-03', $1)`, [SEED_HASH]);
    await expect(
      sql(`INSERT INTO legal_versions (locale, version, effective_on, text_sha256) VALUES ('vi', '2026-10-03', DATE '2026-10-03', $1)`, [SEED_HASH]),
    ).rejects.toThrow(/legal_versions_pkey/);
    await expect(
      sql(`INSERT INTO legal_versions (locale, version, effective_on, text_sha256) VALUES ('zz', '2026-10-04', DATE '2026-10-04', $1)`, [SEED_HASH]),
    ).rejects.toThrow(/legal_versions_locale_fk/);
    await sql(`DELETE FROM legal_versions WHERE locale = 'vi'`);
  });

  it('keeps phase-7 writes working: a version without a locale is English, a booking may still omit the consent locale', async () => {
    await sql(`INSERT INTO legal_versions (version, effective_on, text_sha256) VALUES ('2026-10-07', DATE '2026-10-07', $1)`, [SEED_HASH]);
    expect(await one(`SELECT locale FROM legal_versions WHERE version = '2026-10-07'`)).toEqual({ locale: 'en' });
    await sql(`DELETE FROM legal_versions WHERE version = '2026-10-07'`);
    await expect(booking('FC-PRE00012', PRIVACY_POLICY_VERSION)).resolves.toBeDefined();
  });

  it('refuses a consent locale without a consent version, and an unknown language', async () => {
    await expect(sql(`UPDATE reservations SET consent_locale = 'en' WHERE reference = 'FC-PRE00011'`)).rejects.toThrow(
      /reservations_consent_locale_check/,
    );
    await expect(sql(`UPDATE reservations SET consent_locale = 'zz' WHERE reference = 'FC-PRE00010'`)).rejects.toThrow(
      /reservations_consent_locale_fk/,
    );
  });

  it('accepts only the scripts the fonts cover', async () => {
    const add = (code: string, script: string) =>
      sql(`INSERT INTO locales (code, bcp47, native_name, short_label, script, sort_order) VALUES ($1, $1, 'X', 'X', $2, 90)`, [code, script]);
    for (const [code, script] of [['ko', 'hangul'], ['zh-hans', 'han-simplified'], ['ja', 'japanese'], ['fr', 'latin']]) {
      await expect(add(code, script)).resolves.toBeDefined();
    }
    await expect(add('ru', 'cyrillic')).rejects.toThrow(/locales_script_check/);
    await sql(`DELETE FROM locales WHERE code IN ('ko', 'zh-hans', 'ja', 'fr')`);
  });

  it('refuses to delete a language a social link names, until the link no longer does', async () => {
    await sql(`INSERT INTO locales (code, bcp47, native_name, short_label, script, sort_order) VALUES ('ko', 'ko', '한국어', 'KO', 'hangul', 30)`);
    const { id } = await one(
      `INSERT INTO social_links (platform, href, visible_locales) VALUES ('kakao', 'https://pf.kakao.com/x', '{ko,en}') RETURNING id`,
    );
    await expect(sql(`DELETE FROM locales WHERE code = 'ko'`)).rejects.toThrow(/social_links\.visible_locales/);
    await sql(`UPDATE social_links SET visible_locales = '{en}' WHERE id = $1`, [id]);
    await expect(sql(`DELETE FROM locales WHERE code = 'ko'`)).resolves.toBeDefined();
    await sql(`DELETE FROM social_links WHERE id = $1`, [id]);
  });

  it('re-runs without adding a version, and fills the consent locale of bookings phase-7 code made since', async () => {
    const versions = await one(`SELECT count(*)::int AS n FROM legal_versions`);
    await sql(readFileSync(FILE, 'utf8'));
    expect(await one(`SELECT count(*)::int AS n FROM legal_versions`)).toEqual(versions);
    expect((await sql(`SELECT reference, consent_locale FROM reservations ORDER BY reference`)).rows).toEqual([
      { reference: 'FC-PRE00010', consent_locale: 'en' },
      { reference: 'FC-PRE00011', consent_locale: null },
      { reference: 'FC-PRE00012', consent_locale: 'en' },
    ]);
    expect((await checks('db/checks/postcheck-010.sql')).filter((r) => !r.ok)).toEqual([]);
  });
});
