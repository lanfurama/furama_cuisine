import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { REGISTRY } from '@/lib/i18n/registry';
import { AGREED_KEYS } from '@/lib/legal';
import { TEST_DATABASE_URL, databaseUrl, migrate, resetDatabase, withClient } from '../helpers/db';
import { BRAND_RENAME, RECORDED } from '../helpers/legal';

/*
 * Migration 015: the brand is Furama Dining World, and the agreed English text
 * names it, so a legal_versions row records the new wording beside 009's seed.
 * The upgrade from 014 and a re-run of the file. The newest English row is the
 * version a booking stamps, so its hash must be the registry's agreed text
 * (the check 009's test held until this wording replaced the seeded one).
 */

const url = databaseUrl('furama_cuisine_migrate015_test');
const FILE = 'db/migrations/015_legal_brand_name.sql';
const sql = (text: string, values: unknown[] = []) => withClient(url, (c) => c.query(text, values));
const one = async (text: string, values: unknown[] = []) => (await sql(text, values)).rows[0];
/** The version in force for English guests, ordered as lib/server/content/policy-version.ts and create.ts order it. */
const newestEnglish = () =>
  one(`SELECT version, text_sha256 FROM legal_versions WHERE locale = 'en' ORDER BY created_at DESC, version DESC LIMIT 1`);

describe.skipIf(!TEST_DATABASE_URL)('migration 015: the brand name in the privacy policy (database)', () => {
  beforeAll(async () => {
    resetDatabase(url, '014_destination_website.sql');
  });

  it('adds the English version 2026-10-15 after the seed, and it becomes the one in force', async () => {
    expect(await newestEnglish()).toEqual({ version: RECORDED.version, text_sha256: RECORDED.sha256 });
    migrate(url, '015_legal_brand_name.sql');
    expect(
      (await sql(`SELECT locale, version, to_char(effective_on, 'YYYY-MM-DD') AS on, text_sha256, created_by FROM legal_versions ORDER BY created_at`)).rows,
    ).toEqual([
      { locale: 'en', version: RECORDED.version, on: RECORDED.version, text_sha256: RECORDED.sha256, created_by: 'seed' },
      { locale: 'en', version: BRAND_RENAME.version, on: BRAND_RENAME.version, text_sha256: BRAND_RENAME.sha256, created_by: 'migration 015' },
    ]);
    expect(await newestEnglish()).toEqual({ version: BRAND_RENAME.version, text_sha256: BRAND_RENAME.sha256 });
  });

  it('records the hash of the registry’s agreed English text, as the version check computes it', async () => {
    const text = JSON.stringify(AGREED_KEYS.map((k) => [k, REGISTRY[k].en]));
    expect(createHash('sha256').update(text).digest('hex')).toBe((await newestEnglish()).text_sha256);
  });

  it('re-runs without adding a row', async () => {
    await sql(readFileSync(FILE, 'utf8'));
    expect(await one(`SELECT count(*)::int AS n FROM legal_versions`)).toEqual({ n: 2 });
  });
});
