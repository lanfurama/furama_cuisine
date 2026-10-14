import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { BEFORE_011, TEST_DATABASE_URL, databaseUrl, migrate, resetDatabase, withClient } from '../helpers/db';

/*
 * Migration 011 (owner, 2026-10-14: the languages are code): the locales
 * table goes with its sixteen foreign keys and its delete guard, and
 * social_links.visible_locales goes. Every locale value stays where it was,
 * a code the table never had is accepted once the keys are gone, and the
 * file runs again without error.
 */

const url = databaseUrl('furama_cuisine_migrate011_test');
const FILE = 'db/migrations/011_drop_locales.sql';
const sql = (text: string, values: unknown[] = []) => withClient(url, (c) => c.query(text, values));
const one = async (text: string, values: unknown[] = []) => (await sql(text, values)).rows[0];

describe.skipIf(!TEST_DATABASE_URL)('migration 011: languages in code (database)', () => {
  beforeAll(async () => {
    resetDatabase(url, BEFORE_011);
    await sql(`UPDATE locales SET is_enabled = true WHERE code = 'vi'`);
    await sql(`INSERT INTO content_strings (key, locale, value, status, origin) VALUES ('stories.title', 'vi', 'Chuyện từ gian bếp', 'reviewed', 'human')`);
    await sql(`UPDATE social_links SET visible_locales = '{vi}' WHERE platform = 'youtube'`);
    migrate(url);
  });

  it('drops the table, its foreign keys and its delete guard', async () => {
    expect(await one(`SELECT to_regclass('locales') AS t`)).toEqual({ t: null });
    expect(await one(`SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f' AND conname LIKE '%locale%'`)).toEqual({ n: 0 });
    expect(await one(`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'locales_delete_guard'`)).toEqual({ n: 0 });
  });

  it('keeps every translation, and drops the social links’ language list', async () => {
    expect(await one(`SELECT value FROM content_strings WHERE key = 'stories.title' AND locale = 'vi'`)).toEqual({ value: 'Chuyện từ gian bếp' });
    expect(await one(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'social_links' AND column_name = 'visible_locales'`)).toEqual({ n: 0 });
    expect(await one(`SELECT count(*)::int AS n FROM social_links WHERE platform = 'youtube'`)).toEqual({ n: 1 });
  });

  it('takes a language the table never had: the code checks a code now', async () => {
    await sql(`INSERT INTO content_strings (key, locale, value, status, origin) VALUES ('stories.title', 'ko', '주방 이야기', 'reviewed', 'human')`);
    expect(await one(`SELECT count(*)::int AS n FROM content_strings WHERE locale = 'ko'`)).toEqual({ n: 1 });
  });

  it('runs again without error', async () => {
    await sql(readFileSync(FILE, 'utf8'));
    expect(await one(`SELECT to_regclass('locales') AS t`)).toEqual({ t: null });
  });
});
