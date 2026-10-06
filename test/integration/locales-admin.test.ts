import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool } from '@/db/client';
import type { AuditActor } from '@/lib/server/audit';
import {
  addableLanguages,
  addLocale,
  deleteImpact,
  deleteLocale,
  listLocalesAdmin,
  listSocialLocales,
  missingGuestEmailKeys,
  moveLocale,
  saveSocialLocales,
  setLocaleEnabled,
  setServeMachine,
} from '@/lib/server/content-admin/locales';
import { loadSocials } from '@/lib/server/content/site.queries';
import { TEST_DATABASE_URL } from '../helpers/db';

/*
 * /admin/locales against the database (spec §8, R8-2, R8-6, R39): each rule
 * refused in the transaction, each write with its audit row, and the table's
 * token refusing a second Admin's stale page.
 */

const pool = getPool();
const ACTOR: AuditActor = { id: 'staff-lan', email: 'lan@furama.test', name: 'Lan' };
const token = async () => (await listLocalesAdmin(pool)).token;
const row = async (code: string) => (await listLocalesAdmin(pool)).locales.find((l) => l.code === code);
const order = async () => (await listLocalesAdmin(pool)).locales.map((l) => l.code);
const audits = async () =>
  (await pool.query(`SELECT action, entity_id FROM audit_log WHERE entity_type = 'locales' ORDER BY id`)).rows.map((r) => `${r.action}:${r.entity_id ?? '-'}`);

async function reset() {
  await pool.query(`UPDATE social_links SET visible_locales = NULL`);
  await pool.query(`DELETE FROM content_strings WHERE locale NOT IN ('en', 'vi')`);
  await pool.query(`DELETE FROM locales WHERE code NOT IN ('en', 'vi')`);
  await pool.query(`UPDATE locales SET is_enabled = (code = 'en'), serve_machine = false, sort_order = CASE code WHEN 'en' THEN 10 ELSE 20 END`);
  await pool.query(`DELETE FROM audit_log WHERE entity_type IN ('locales', 'social_links')`);
}

/** Every guest email key in `code`, as reviewed rows (what an editor would save on the emails screen). */
async function translateGuestEmails(code: string) {
  for (const key of await missingGuestEmailKeys(pool, code)) {
    await pool.query(`INSERT INTO content_strings (key, locale, value, status, origin) VALUES ($1, $2, $3, 'reviewed', 'human')`, [key, code, `[${code}] ${key}`]);
  }
}

describe.skipIf(!TEST_DATABASE_URL)('/admin/locales (database)', () => {
  beforeEach(reset);
  afterAll(reset);

  it('adds a language from the catalogue only, off and last, once', async () => {
    expect((await addableLanguages(pool)).map((l) => l.code)).toContain('ko');
    expect(await addLocale(pool, ACTOR, { code: 'ko', token: await token() })).toEqual({ ok: true, data: { changed: ['ko'] } });
    expect(await row('ko')).toMatchObject({ bcp47: 'ko', nativeName: '한국어', shortLabel: 'KO', script: 'hangul', isEnabled: false, isDefault: false });
    expect(await order()).toEqual(['en', 'vi', 'ko']);
    expect(await addLocale(pool, ACTOR, { code: 'ko', token: await token() })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await addLocale(pool, ACTOR, { code: 'xx', token: await token() })).toMatchObject({ ok: false, code: 'invalid' });
    expect((await addableLanguages(pool)).map((l) => l.code)).not.toContain('ko');
    expect(await audits()).toEqual(['create:ko']);
  });

  it('refuses a stale page: the table’s token changed since it was read', async () => {
    const stale = await token();
    await addLocale(pool, ACTOR, { code: 'ko', token: stale });
    expect(await setServeMachine(pool, ACTOR, { code: 'vi', on: true, token: stale })).toMatchObject({ ok: false, code: 'conflict' });
    expect((await row('vi'))?.serveMachine).toBe(false);
  });

  it('enables a language only once its guest emails have a text in it (R8-6); vi has the registry’s own', async () => {
    expect(await missingGuestEmailKeys(pool, 'vi')).toEqual([]);
    expect(await setLocaleEnabled(pool, ACTOR, { code: 'vi', enabled: true, token: await token() })).toEqual({ ok: true, data: { changed: ['vi'] } });

    await addLocale(pool, ACTOR, { code: 'ko', token: await token() });
    const refused = await setLocaleEnabled(pool, ACTOR, { code: 'ko', enabled: true, token: await token() });
    expect(refused).toMatchObject({ ok: false, code: 'invalid', fieldErrors: { emails: [expect.stringContaining('email.')] } });
    expect((await row('ko'))?.isEnabled).toBe(false);

    await translateGuestEmails('ko');
    expect(await setLocaleEnabled(pool, ACTOR, { code: 'ko', enabled: true, token: await token() })).toEqual({ ok: true, data: { changed: ['ko'] } });
    expect((await row('ko'))?.isEnabled).toBe(true);
  });

  it('never disables or deletes the default language', async () => {
    expect(await setLocaleEnabled(pool, ACTOR, { code: 'en', enabled: false, token: await token() })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await deleteLocale(pool, ACTOR, { code: 'en', token: await token() })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('turns serve_machine on and off, and moves a language in the order', async () => {
    expect(await setServeMachine(pool, ACTOR, { code: 'vi', on: true, token: await token() })).toEqual({ ok: true, data: { changed: ['vi'] } });
    expect((await row('vi'))?.serveMachine).toBe(true);
    expect(await moveLocale(pool, ACTOR, { code: 'vi', direction: 'up', token: await token() })).toEqual({ ok: true, data: { changed: [] } });
    expect(await order()).toEqual(['vi', 'en']);
    expect(await moveLocale(pool, ACTOR, { code: 'vi', direction: 'up', token: await token() })).toEqual({ ok: true, data: { changed: [] } });
    expect(await order()).toEqual(['vi', 'en']);
    expect(await audits()).toEqual(['update:vi', 'reorder:-']);
  });

  it('deletes only a disabled language nothing keeps, and its translations with it (R8-2)', async () => {
    await addLocale(pool, ACTOR, { code: 'ko', token: await token() });
    await pool.query(`INSERT INTO cuisine_i18n (cuisine_id, locale, label) SELECT id, 'ko', '한식' FROM cuisines ORDER BY sort_order LIMIT 1`);
    await pool.query(`INSERT INTO content_strings (key, locale, value) VALUES ('ui.reserve', 'ko', '예약')`);
    expect(await deleteImpact(pool, 'ko')).toEqual({ translations: 1, strings: 1 });

    await translateGuestEmails('ko');
    await setLocaleEnabled(pool, ACTOR, { code: 'ko', enabled: true, token: await token() });
    expect(await deleteLocale(pool, ACTOR, { code: 'ko', token: await token() })).toMatchObject({ ok: false, code: 'invalid' });
    await setLocaleEnabled(pool, ACTOR, { code: 'ko', enabled: false, token: await token() });

    const [link] = await listSocialLocales(pool);
    await saveSocialLocales(pool, ACTOR, link.id, link.token, { visibleLocales: ['ko'] });
    expect(await deleteLocale(pool, ACTOR, { code: 'ko', token: await token() })).toMatchObject({
      ok: false,
      code: 'invalid',
      fieldErrors: { code: [expect.stringContaining(link.name)] },
    });
    const [again] = await listSocialLocales(pool);
    await saveSocialLocales(pool, ACTOR, again.id, again.token, { visibleLocales: null });

    expect(await deleteLocale(pool, ACTOR, { code: 'ko', token: await token() })).toEqual({ ok: true, data: { changed: ['ko'] } });
    expect(await row('ko')).toBeUndefined();
    expect(await deleteImpact(pool, 'ko')).toEqual({ translations: 0, strings: 0 });
  });

  it('keeps a language a booking used: it can only be turned off', async () => {
    await pool.query(
      `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source, locale)
       VALUES ('FC-LOC00001', 'taya-house', '2026-10-06', '19:00', 'Dinner', 2, 'G', '0905 222 333', '+84905222333', 'web', 'vi')`,
    );
    try {
      expect(await deleteLocale(pool, ACTOR, { code: 'vi', token: await token() })).toMatchObject({
        ok: false,
        code: 'invalid',
        fieldErrors: { code: [expect.stringContaining('đặt bàn')] },
      });
    } finally {
      await pool.query(`DELETE FROM reservations WHERE reference = 'FC-LOC00001'`);
    }
  });

  it('sets which languages a social link shows in (R39), and the footer follows', async () => {
    const [link] = await listSocialLocales(pool);
    expect(link.visibleLocales).toBeNull();
    expect(await saveSocialLocales(pool, ACTOR, link.id, link.token, { visibleLocales: ['vi'] })).toMatchObject({ ok: true });
    expect((await listSocialLocales(pool))[0].visibleLocales).toEqual(['vi']);
    expect((await loadSocials('en')).length).toBe((await loadSocials('vi')).length - 1);
    const [now] = await listSocialLocales(pool);
    expect(await saveSocialLocales(pool, ACTOR, now.id, now.token, { visibleLocales: ['zz'] })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await saveSocialLocales(pool, ACTOR, now.id, now.token, { visibleLocales: [] })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await saveSocialLocales(pool, ACTOR, now.id, link.token, { visibleLocales: null })).toMatchObject({ ok: false, code: 'conflict' });
  });
});
