import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, query } from '@/db/client';
import { REGISTRY } from '@/lib/i18n/registry';
import { resolveStrings } from '@/lib/i18n/resolve';
import { AGREED_KEYS } from '@/lib/legal';
import { currentPolicyVersion, listPolicyVersions } from '@/lib/server/content/policy-version';
import {
  loadScreenHistory,
  loadScreenStrings,
  restoreString,
  saveStrings,
  stringSource,
  type StringsInput,
} from '@/lib/server/content/strings-admin';
import { loadStringRows } from '@/lib/server/content/strings.queries';

/*
 * Phase 8 C9: a strings screen edits one language (?lang=). Each language's
 * row of a key has its own token, lock and History; a translation keeps the
 * English text's variables (names and kinds, spec §7.4) and the fingerprint
 * of the English it was written against ("EN đã đổi"); an emptied one goes
 * back to English. Agreed text has versions per language (R8-7).
 */

const LAN = { id: 'staff-lan', email: 'lan@furama.test' };

async function screen(name: StringsInput['screen'], locale: string) {
  const fields = await loadScreenStrings(getPool(), name, locale);
  return {
    fields,
    field: (key: string) => fields.find((f) => f.key === key)!,
    /** As the form posts it: every field as loaded, with `edits` typed over them. */
    input(edits: Record<string, string>): StringsInput {
      return {
        screen: name,
        locale,
        values: { ...Object.fromEntries(fields.map((f) => [f.key, f.value])), ...edits },
        originals: Object.fromEntries(fields.map((f) => [f.key, f.value])),
        tokens: Object.fromEntries(fields.map((f) => [f.key, f.token])),
      };
    },
  };
}

async function viGuestSees<K extends 'stories.title' | 'offers.price_net'>(key: K) {
  const { defaultLocale, rows } = await loadStringRows('vi', [key]);
  return resolveStrings(rows, [key], 'vi', defaultLocale)[key];
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('content strings per language (database)', () => {
  beforeEach(async () => {
    await query('DELETE FROM content_strings');
    await query(`DELETE FROM audit_log WHERE entity_type IN ('content_strings', 'legal_versions')`);
    await query(`DELETE FROM legal_versions WHERE created_by IS DISTINCT FROM 'seed'`);
    await query(`DELETE FROM staff_user WHERE id = 'staff-lan'`);
    await query(`INSERT INTO staff_user (id, name, email, email_verified, role) VALUES ('staff-lan', 'Lan', 'lan@furama.test', true, 'editor')`);
  });
  afterAll(async () => {
    await query('DELETE FROM content_strings');
    await query(`DELETE FROM legal_versions WHERE created_by IS DISTINCT FROM 'seed'`);
    await query(`DELETE FROM staff_user WHERE id = 'staff-lan'`);
    await getPool().end();
  });

  it('loads a language: empty and "Chưa dịch" without a row, the registry’s Vietnamese where it has one', async () => {
    const stories = await screen('stories', 'vi');
    expect(stories.field('stories.title')).toMatchObject({ value: '', overridden: false, token: '', english: REGISTRY['stories.title'].en, state: 'missing' });
    const emails = await screen('emails', 'vi');
    const staff = emails.field('email.staff.new.heading');
    expect(staff).toMatchObject({ value: REGISTRY['email.staff.new.heading'].vi, overridden: false, state: 'reviewed' });
    // The default language is always reviewed.
    expect((await screen('stories', 'en')).field('stories.title').state).toBe('reviewed');
  });

  it('a Vietnamese save writes a reviewed row with the English fingerprint; an English edit makes it "EN đã đổi"; emptied it goes', async () => {
    const vi = await screen('stories', 'vi');
    const saved = await saveStrings(getPool(), LAN, vi.input({ 'stories.title': 'Chuyện từ bếp' }));
    expect(saved).toMatchObject({ ok: true, data: { changed: ['stories.title'] } });
    expect(await query(`SELECT locale, value, status, origin, source_hash FROM content_strings`)).toEqual([
      { locale: 'vi', value: 'Chuyện từ bếp', status: 'reviewed', origin: 'human', source_hash: stringSource(REGISTRY['stories.title'].en) },
    ]);
    expect(await viGuestSees('stories.title')).toBe('Chuyện từ bếp');
    expect((await screen('stories', 'vi')).field('stories.title')).toMatchObject({ value: 'Chuyện từ bếp', overridden: true, state: 'reviewed' });
    // English stays as it was: the Vietnamese save wrote one row.
    expect((await screen('stories', 'en')).field('stories.title')).toMatchObject({ value: REGISTRY['stories.title'].en, overridden: false });

    await saveStrings(getPool(), LAN, (await screen('stories', 'en')).input({ 'stories.title': 'Stories from the Kitchens' }));
    expect((await screen('stories', 'vi')).field('stories.title')).toMatchObject({ english: 'Stories from the Kitchens', state: 'stale' });

    expect(await saveStrings(getPool(), LAN, (await screen('stories', 'vi')).input({ 'stories.title': '' }))).toMatchObject({ ok: true });
    expect(await query(`SELECT locale FROM content_strings ORDER BY locale`)).toEqual([{ locale: 'en' }]);
    expect(await viGuestSees('stories.title')).toBe('Stories from the Kitchens');
    expect((await screen('stories', 'vi')).field('stories.title').state).toBe('missing');
  });

  it('refuses a translation whose variables differ from the English text’s, by name or by kind (spec §7.4)', async () => {
    const offers = await screen('offers', 'vi');
    const missing = await saveStrings(getPool(), LAN, offers.input({ 'offers.price_net': '{amount} mỗi khách' }));
    expect(missing).toEqual({
      ok: false,
      code: 'invalid',
      fieldErrors: { 'v:offers.price_net': ['Biến khác bản tiếng Anh: thiếu {currency}.'] },
    });
    const extra = await saveStrings(getPool(), LAN, offers.input({ 'offers.price_net': '{currency} {amount} {tax} mỗi khách' }));
    expect(extra.ok === false && extra.code === 'invalid' && extra.fieldErrors['v:offers.price_net']).toEqual(['Biến khác bản tiếng Anh: thừa {tax}.']);

    const destinations = await screen('destinations', 'vi');
    const kind = await saveStrings(getPool(), LAN, destinations.input({ 'destinations.count': '{count} nhà hàng' }));
    expect(kind.ok === false && kind.code === 'invalid' && kind.fieldErrors['v:destinations.count']![0]).toContain('{count} phải dùng kiểu như bản tiếng Anh');
    // Vietnamese has only `other`: a plural with that branch alone is the same kind.
    expect(await saveStrings(getPool(), LAN, destinations.input({ 'destinations.count': '{count, plural, other {# nhà hàng}}' }))).toMatchObject({ ok: true });
    expect(await saveStrings(getPool(), LAN, offers.input({ 'offers.price_net': '{amount} {currency} đã gồm phí mỗi khách' }))).toMatchObject({ ok: true });
    expect(await viGuestSees('offers.price_net')).toBe('{amount} {currency} đã gồm phí mỗi khách');
  });

  it('a language that is not in the table is refused', async () => {
    const input = (await screen('stories', 'vi')).input({ 'stories.title': 'X' });
    expect(await saveStrings(getPool(), LAN, { ...input, locale: 'xx' })).toMatchObject({ ok: false, code: 'invalid', fieldErrors: { locale: expect.any(Array) } });
  });

  it('each language has its own token: a Vietnamese save never makes an English form stale, and a stale Vietnamese one conflicts', async () => {
    const en = await screen('stories', 'en');
    const vi = await screen('stories', 'vi');
    await saveStrings(getPool(), LAN, vi.input({ 'stories.title': 'Chuyện từ bếp' }));
    expect(await saveStrings(getPool(), LAN, en.input({ 'stories.title': 'Kitchen Stories' }))).toMatchObject({ ok: true });
    expect(await saveStrings(getPool(), LAN, vi.input({ 'stories.title': 'Chuyện bếp' }))).toMatchObject({ ok: false, code: 'conflict' });
  });

  it('History is per language: a Vietnamese restore puts back the Vietnamese, and never takes an English row', async () => {
    await saveStrings(getPool(), LAN, (await screen('stories', 'en')).input({ 'stories.title': 'Kitchen Stories' }));
    await saveStrings(getPool(), LAN, (await screen('stories', 'vi')).input({ 'stories.title': 'Chuyện từ bếp' }));
    const [viEdit, ...rest] = await loadScreenHistory(getPool(), 'stories', 'vi');
    expect(rest).toEqual([]);
    expect(viEdit).toMatchObject({ key: 'stories.title', action: 'create', before: { value: '', overridden: false }, after: { value: 'Chuyện từ bếp' } });
    const [enEdit] = await loadScreenHistory(getPool(), 'stories', 'en');

    const token = (await screen('stories', 'vi')).field('stories.title').token;
    expect(await restoreString(getPool(), LAN, { key: 'stories.title', locale: 'vi', auditId: enEdit.id, side: 'before', token })).toEqual({ ok: false, code: 'not_found' });
    expect(await restoreString(getPool(), LAN, { key: 'stories.title', locale: 'vi', auditId: viEdit.id, side: 'before', token })).toMatchObject({ ok: true });
    expect(await query(`SELECT locale, value FROM content_strings`)).toEqual([{ locale: 'en', value: 'Kitchen Stories' }]);
  });

  describe('agreed text has versions per language (R8-7)', () => {
    it('a Vietnamese policy save versions Vietnamese only; English stays in force for English guests', async () => {
      const saved = await saveStrings(getPool(), LAN, (await screen('legal', 'vi')).input({ 'legal.title': 'Chính sách quyền riêng tư' }));
      expect(saved.ok && saved.data).toMatchObject({ policyVersion: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), policyChanged: true });
      expect(await currentPolicyVersion(getPool(), 'en')).toMatchObject({ version: '2026-10-03', locale: 'en' });
      expect(await currentPolicyVersion(getPool(), 'vi')).toMatchObject({ version: saved.ok ? saved.data.policyVersion : '', locale: 'vi' });
      // A language without versions agrees to the English wording, and says so.
      expect(await currentPolicyVersion(getPool(), 'ko')).toMatchObject({ version: '2026-10-03', locale: 'en' });
    });

    it('an English save versions a language that reads the English text of a changed key, not one with its own', async () => {
      await saveStrings(getPool(), LAN, (await screen('legal', 'vi')).input({ 'legal.title': 'Chính sách quyền riêng tư' }));
      const before = await listPolicyVersions(getPool(), 'vi');

      // Vietnamese has no row of its own for keep_body: its guests read the English, which changes.
      await saveStrings(getPool(), LAN, (await screen('legal', 'en')).input({ 'legal.keep_body': 'We keep your booking for 24 months.' }));
      expect(await listPolicyVersions(getPool(), 'vi')).toHaveLength(before.length + 1);

      // Once every agreed key has its Vietnamese row, English edits leave the Vietnamese version alone.
      const vi = await screen('legal', 'vi');
      // (Its own copy of each English sentence is enough: a row of its own.)
      await saveStrings(getPool(), LAN, vi.input(Object.fromEntries(AGREED_KEYS.map((k) => [k, vi.field(k).value || vi.field(k).english]))));
      expect(await query(`SELECT count(*)::int AS n FROM content_strings WHERE locale = 'vi'`)).toEqual([{ n: AGREED_KEYS.length }]);
      const settled = await listPolicyVersions(getPool(), 'vi');
      await saveStrings(getPool(), LAN, (await screen('legal', 'en')).input({ 'legal.keep_body': 'We keep your booking for 36 months.' }));
      expect(await listPolicyVersions(getPool(), 'vi')).toEqual(settled);
    });
  });
});
