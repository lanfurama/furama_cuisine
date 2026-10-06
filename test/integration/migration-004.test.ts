import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, databaseUrl, migrate, resetDatabase, withClient } from '../helpers/db';

const url = databaseUrl('furama_cuisine_migrate004_test');
const sql = (text: string, values: unknown[] = []) => withClient(url, (c) => c.query(text, values));

describe.skipIf(!TEST_DATABASE_URL)('migration 004: locales, content_strings, destinations (database)', () => {
  beforeAll(() => resetDatabase(url));

  it('seeds en (default, enabled) and vi (disabled)', async () => {
    const { rows } = await sql(
      'SELECT code, bcp47, is_default, is_enabled, serve_machine FROM locales ORDER BY sort_order',
    );
    expect(rows).toEqual([
      { code: 'en', bcp47: 'en', is_default: true, is_enabled: true, serve_machine: false },
      { code: 'vi', bcp47: 'vi', is_default: false, is_enabled: false, serve_machine: false },
    ]);
  });

  it('seeds the four destinations from lib/data.ts and starts content_strings empty', async () => {
    const { rows } = await sql(
      'SELECT id, kind, phone_e164, phone_display, show_in_footer FROM destinations ORDER BY sort_order',
    );
    expect(rows).toEqual([
      { id: 'resort', kind: 'venue', phone_e164: '+842366519999', phone_display: '+84 236 651 9999', show_in_footer: true },
      { id: 'dining-house', kind: 'venue', phone_e164: '+84859555759', phone_display: '0859 555 759', show_in_footer: true },
      { id: 'mm', kind: 'venue', phone_e164: null, phone_display: null, show_in_footer: false },
      { id: 'future', kind: 'teaser', phone_e164: null, phone_display: null, show_in_footer: false },
    ]);
    expect((await sql('SELECT count(*)::int AS n FROM content_strings')).rows[0].n).toBe(0);
  });

  it('every seeded restaurant points at a destination', async () => {
    const { rows } = await sql(
      `SELECT count(*)::int AS n FROM restaurants r LEFT JOIN destinations d ON d.id = r.destination WHERE d.id IS NULL`,
    );
    expect(rows[0].n).toBe(0);
    await expect(sql(`UPDATE restaurants SET destination = 'nowhere' WHERE id = 'taya-house'`)).rejects.toThrow(
      /restaurants_destination_fk/,
    );
  });

  it('allows only one default language', async () => {
    await expect(sql(`UPDATE locales SET is_default = true, is_enabled = true WHERE code = 'vi'`)).rejects.toThrow(
      /locales_single_default_idx/,
    );
  });

  it('never lets the default language be disabled', async () => {
    await expect(sql(`UPDATE locales SET is_enabled = false WHERE code = 'en'`)).rejects.toThrow(
      /locales_default_enabled/,
    );
  });

  it.each(['EN', 'e', 'zh_hans', 'zh-', '-en', 'en us', ''])('rejects the locale code %j', async (code) => {
    await expect(
      sql(`INSERT INTO locales (code, bcp47, native_name, short_label, script) VALUES ($1, 'en', 'x', 'X', 'latin')`, [code]),
    ).rejects.toThrow(/locales_code_check/);
  });

  it('accepts zh-hans and ko', async () => {
    // The scripts are the keys migration 010 allows (lib/i18n/scripts.ts SCRIPTS): this database runs every migration.
    await sql(
      `INSERT INTO locales (code, bcp47, native_name, short_label, script, sort_order)
       VALUES ('zh-hans', 'zh-Hans', '简体中文', '中文', 'han-simplified', 30), ('ko', 'ko', '한국어', 'KO', 'hangul', 40)`,
    );
    expect((await sql('SELECT count(*)::int AS n FROM locales')).rows[0].n).toBe(4);
  });

  it('rejects malformed content keys, statuses and origins', async () => {
    const insert = (key: string, status = 'reviewed', origin = 'human') =>
      sql(`INSERT INTO content_strings (key, locale, value, status, origin) VALUES ($1, 'en', 'v', $2, $3)`, [
        key,
        status,
        origin,
      ]);
    await expect(insert('NoDots')).rejects.toThrow(/content_strings_key_check/);
    await expect(insert('Upper.case')).rejects.toThrow(/content_strings_key_check/);
    await expect(insert('error.full', 'draft')).rejects.toThrow(/content_strings_status_check/);
    await expect(insert('error.full', 'reviewed', 'robot')).rejects.toThrow(/content_strings_origin_check/);
    await insert('error.full');
  });

  it('rejects a row for an unknown locale, and keys are unique per locale', async () => {
    await expect(sql(`INSERT INTO content_strings (key, locale, value) VALUES ('error.full', 'xx', 'v')`)).rejects.toThrow(
      /content_strings_locale_fkey/,
    );
    await expect(sql(`INSERT INTO content_strings (key, locale, value) VALUES ('error.full', 'en', 'dup')`)).rejects.toThrow(
      /content_strings_pkey/,
    );
  });

  it('cascades a renamed or deleted locale into its strings', async () => {
    await sql(`INSERT INTO content_strings (key, locale, value) VALUES ('error.full', 'ko', '가득')`);
    await sql(`UPDATE locales SET code = 'kr', bcp47 = 'ko' WHERE code = 'ko'`);
    expect((await sql(`SELECT value FROM content_strings WHERE locale = 'kr'`)).rows).toEqual([{ value: '가득' }]);
    await sql(`DELETE FROM locales WHERE code = 'kr'`);
    expect((await sql(`SELECT count(*)::int AS n FROM content_strings WHERE locale = 'kr'`)).rows[0].n).toBe(0);
    // the English row is untouched
    expect((await sql(`SELECT count(*)::int AS n FROM content_strings WHERE locale = 'en'`)).rows[0].n).toBe(1);
  });

  it('checks destination ids, kinds, phones and the map URL', async () => {
    const insert = (cols: string, vals: string) => sql(`INSERT INTO destinations (id, kind${cols}) VALUES ${vals}`);
    await expect(insert('', `('Bad Id', 'venue')`)).rejects.toThrow(/destinations_id_check/);
    await expect(insert('', `('x1', 'hotel')`)).rejects.toThrow(/destinations_kind_check/);
    await expect(insert(', phone_e164, phone_display', `('x2', 'venue', '0905', '0905')`)).rejects.toThrow(
      /destinations_phone_e164_check/,
    );
    await expect(insert(', phone_e164', `('x3', 'venue', '+84905000000')`)).rejects.toThrow(/destinations_phone_pair/);
    await expect(insert(', map_url', `('x4', 'venue', 'http://maps.example')`)).rejects.toThrow(
      /destinations_map_url_check/,
    );
  });

  it("is safe to apply again: nothing is duplicated and an editor's change survives", async () => {
    await sql(`UPDATE destinations SET phone_display = '+84 236 651 9999 (edited)' WHERE id = 'resort'`);
    await sql(readFileSync('db/migrations/004_foundations_locales_strings_destinations.sql', 'utf8'));
    expect((await sql('SELECT count(*)::int AS n FROM destinations')).rows[0].n).toBe(4);
    expect((await sql('SELECT count(*)::int AS n FROM locales WHERE code IN (\'en\',\'vi\')')).rows[0].n).toBe(2);
    expect((await sql(`SELECT phone_display FROM destinations WHERE id = 'resort'`)).rows[0].phone_display).toBe(
      '+84 236 651 9999 (edited)',
    );
  });

  it('applies on top of a database that already has bookings', async () => {
    resetDatabase(url, '003_reservations_phone_e164.sql');
    await sql(
      `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, phone_e164)
       VALUES ('FC-99999', 'taya-house', '2026-10-05', '19:00', 2, 'Guest', '0905 000 000', '+84905000000')`,
    );
    migrate(url);
    expect((await sql(`SELECT count(*)::int AS n FROM reservations WHERE reference = 'FC-99999'`)).rows[0].n).toBe(1);
    expect((await sql('SELECT count(*)::int AS n FROM destinations')).rows[0].n).toBe(4);
  });
});
