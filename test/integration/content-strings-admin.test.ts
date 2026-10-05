import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPool, query } from '@/db/client';
import { TAGS } from '@/lib/cache-tags';
import { REGISTRY } from '@/lib/i18n/registry';
import { AGREED_KEYS } from '@/lib/legal';
import { loadScreenHistory, loadScreenStrings, restoreString, saveStrings, tagsForStrings, type StringsInput } from '@/lib/server/content/strings-admin';
import { loadOffers } from '@/lib/server/content/home.queries';
import { currentPolicyVersion, policyTextHash, recordPolicyVersion } from '@/lib/server/content/policy-version';
import { loadStringRows } from '@/lib/server/content/strings.queries';
import { resolveStrings } from '@/lib/i18n/resolve';

/*
 * The content_strings editor's save (spec §7.4, §7.5, §11): validation against
 * the registry, one row per changed key, audit rows that can restore, tokens
 * per key, "Khôi phục mặc định" deleting the row, and a policy version when
 * the agreed text changes.
 */

const LAN = { id: 'staff-lan', email: 'lan@furama.test' };
const MAI = { id: 'staff-mai', email: 'mai@furama.test' };

async function screen(name: StringsInput['screen']) {
  const fields = await loadScreenStrings(getPool(), name);
  return {
    fields,
    /** As the form posts it: every field of the screen, as loaded, with `edits` typed over them. */
    input(edits: Record<string, string>): StringsInput {
      return {
        screen: name,
        values: { ...Object.fromEntries(fields.map((f) => [f.key, f.value])), ...edits },
        originals: Object.fromEntries(fields.map((f) => [f.key, f.value])),
        tokens: Object.fromEntries(fields.map((f) => [f.key, f.token])),
      };
    },
  };
}

async function guestSees(key: 'stories.title' | 'search.popular') {
  const { defaultLocale, rows } = await loadStringRows('en', [key]);
  return resolveStrings(rows, [key], 'en', defaultLocale)[key];
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('content strings editor (database)', () => {
  beforeEach(async () => {
    await query('DELETE FROM content_strings');
    await query(`DELETE FROM audit_log WHERE entity_type IN ('content_strings', 'legal_versions')`);
    await query(`DELETE FROM legal_versions WHERE created_by IS DISTINCT FROM 'seed'`);
    await query(`DELETE FROM staff_user WHERE id IN ('staff-lan', 'staff-mai')`);
    await query(
      `INSERT INTO staff_user (id, name, email, email_verified, role) VALUES
         ('staff-lan', 'Lan', 'lan@furama.test', true, 'editor'), ('staff-mai', 'Mai', 'mai@furama.test', true, 'editor')`,
    );
  });
  afterAll(async () => {
    await query('DELETE FROM content_strings');
    await query(`DELETE FROM legal_versions WHERE created_by IS DISTINCT FROM 'seed'`);
    await query(`DELETE FROM staff_user WHERE id IN ('staff-lan', 'staff-mai')`);
    await getPool().end();
  });

  it('saves only the changed key, as reviewed/human, with an audit row holding both sides', async () => {
    const s = await screen('stories');
    const result = await saveStrings(getPool(), LAN, s.input({ 'stories.title': 'Kitchen Stories', 'stories.lede': REGISTRY['stories.lede'].en }));
    expect(result).toEqual({ ok: true, data: { changed: ['stories.title'], policyVersion: null } });
    expect(await guestSees('stories.title')).toBe('Kitchen Stories');
    const rows = await query(`SELECT key, status, origin, updated_by FROM content_strings`);
    expect(rows).toEqual([{ key: 'stories.title', status: 'reviewed', origin: 'human', updated_by: 'staff-lan' }]);
    const audit = await query(`SELECT action, entity_id, locale, before, after FROM audit_log WHERE entity_type = 'content_strings'`);
    expect(audit).toEqual([
      {
        action: 'create',
        entity_id: 'stories.title',
        locale: 'en',
        before: { value: 'Stories from our Kitchens', overridden: false },
        after: { value: 'Kitchen Stories', overridden: true },
      },
    ]);
  });

  it('putting the default back deletes the row (later code defaults then reach the site)', async () => {
    let s = await screen('stories');
    await saveStrings(getPool(), LAN, s.input({ 'stories.title': 'Kitchen Stories' }));
    s = await screen('stories');
    const result = await saveStrings(getPool(), LAN, s.input({ 'stories.title': REGISTRY['stories.title'].en }));
    expect(result.ok && result.data.changed).toEqual(['stories.title']);
    expect(await query(`SELECT 1 FROM content_strings`)).toEqual([]);
    expect(await query(`SELECT action FROM audit_log WHERE entity_type = 'content_strings' ORDER BY id`)).toEqual([
      { action: 'create' },
      { action: 'delete' },
    ]);
  });

  it('refuses a value whose ICU variables differ from the registry’s (spec §7.4), and an over-long one, writing nothing', async () => {
    const s = await screen('ui-text');
    const result = await saveStrings(
      getPool(),
      LAN,
      s.input({ 'search.results': '{n} RESULTS', 'search.none': 'Nothing for {query}', 'search.popular': 'P'.repeat(33) }),
    );
    expect(result).toMatchObject({ ok: false, code: 'invalid' });
    if (result.ok || result.code !== 'invalid') throw new Error('expected invalid');
    expect(Object.keys(result.fieldErrors).sort()).toEqual(['v:search.popular', 'v:search.results']);
    expect(result.fieldErrors['v:search.results'].join(' ')).toContain('{count}');
    expect(await query(`SELECT 1 FROM content_strings`)).toEqual([]);
  });

  it('refuses a key of another screen (a forged form)', async () => {
    const s = await screen('stories');
    const result = await saveStrings(getPool(), LAN, { ...s.input({}), values: { 'legal.title': 'Hacked' } });
    expect(result).toMatchObject({ ok: false, code: 'invalid', fieldErrors: { 'v:legal.title': expect.any(Array) } });
  });

  it('two editors: a different key is no conflict; the same key is, naming who saved first', async () => {
    const lan = await screen('ui-text');
    const mai = await screen('ui-text');
    expect((await saveStrings(getPool(), MAI, mai.input({ 'search.popular': 'TOP CUISINES' }))).ok).toBe(true);
    // Lan never touched search.popular: her stale copy of it is skipped, not written back.
    expect(await saveStrings(getPool(), LAN, lan.input({ 'search.view': 'Open' }))).toMatchObject({ ok: true });
    expect(await guestSees('search.popular')).toBe('TOP CUISINES');
    // Now Lan edits the key Mai changed after Lan loaded the page.
    const clash = await saveStrings(getPool(), LAN, lan.input({ 'search.popular': 'FAVOURITES' }));
    expect(clash).toMatchObject({ ok: false, code: 'conflict', params: { by: 'Mai' } });
    expect(await guestSees('search.popular')).toBe('TOP CUISINES');
  });

  it('a stale key refuses the whole save: a key checked earlier is not written, nor audited', async () => {
    const lan = await screen('ui-text');
    const mai = await screen('ui-text');
    expect((await saveStrings(getPool(), MAI, mai.input({ 'search.view': 'Open' }))).ok).toBe(true);
    // Lan's page predates Mai's save of search.view; her search.popular comes first in the screen's order.
    const clash = await saveStrings(getPool(), LAN, lan.input({ 'search.popular': 'FAVOURITES', 'search.view': 'See' }));
    expect(clash).toMatchObject({ ok: false, code: 'conflict', params: { by: 'Mai' } });
    expect(await query(`SELECT value FROM content_strings WHERE key = 'search.popular'`)).toEqual([]);
    expect(await query(`SELECT 1 FROM audit_log WHERE entity_type = 'content_strings' AND entity_id = 'search.popular'`)).toEqual([]);
    expect(await guestSees('search.popular')).toBe(REGISTRY['search.popular'].en);
  });

  describe('on a Preview (VERCEL_ENV=preview), whose database is production’s', () => {
    const REFUSED = 'Chữ khách đồng ý (chính sách, câu đồng ý) chỉ sửa trên trang chính thức: bản preview dùng chung dữ liệu với Production.';
    beforeEach(() => {
      vi.stubEnv('VERCEL_ENV', 'preview');
    });
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('refuses to save or restore agreed text (its hash would come from the branch’s registry); other keys still save', async () => {
      const versions = async () => (await query(`SELECT version FROM legal_versions ORDER BY version`)).length;
      const before = await versions();
      const saved = await saveStrings(getPool(), LAN, (await screen('legal')).input({ 'legal.title': 'Privacy' }));
      expect(saved).toEqual({ ok: false, code: 'invalid', fieldErrors: { 'v:legal.title': [REFUSED] } });
      expect(await query(`SELECT 1 FROM content_strings`)).toEqual([]);
      expect(await versions()).toBe(before);

      const { rows } = await getPool().query<{ id: string }>(
        `INSERT INTO audit_log (action, entity_type, entity_id, locale, before, after)
         VALUES ('update', 'content_strings', 'booking.consent', 'en', '{"value":"I agree.","overridden":true}', '{"value":"I agree to it.","overridden":true}')
         RETURNING id::text`,
      );
      const restored = await restoreString(getPool(), LAN, { key: 'booking.consent', auditId: rows[0].id, side: 'before', token: '' });
      expect(restored).toEqual({ ok: false, code: 'invalid', fieldErrors: { 'v:booking.consent': [REFUSED] } });
      expect(await query(`SELECT 1 FROM content_strings`)).toEqual([]);
      expect(await versions()).toBe(before);

      expect(await saveStrings(getPool(), LAN, (await screen('ui-text')).input({ 'search.popular': 'TOP CUISINES' }))).toEqual({
        ok: true,
        data: { changed: ['search.popular'], policyVersion: null },
      });
    });
  });

  it('changing the policy text adds a version once; a save that leaves it as it was adds none', async () => {
    expect((await currentPolicyVersion(getPool())).version).toBe('2026-10-03');
    let s = await screen('legal');
    const first = await saveStrings(getPool(), LAN, s.input({ 'legal.keep_body': 'We keep your booking for 24 months, then anonymise it.' }));
    expect(first.ok && first.data.policyVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    s = await screen('legal');
    const second = await saveStrings(getPool(), LAN, s.input({ 'booking.consent': 'I agree to the privacy policy.' }));
    expect(second.ok && second.data.policyVersion).toMatch(/^\d{4}-\d{2}-\d{2}\.2$/);
    // Saving a key with the text it already has changes nothing, so no version.
    s = await screen('legal');
    const unchanged = await saveStrings(getPool(), LAN, s.input({ 'legal.title': REGISTRY['legal.title'].en }));
    expect(unchanged.ok && unchanged.data).toEqual({ changed: [], policyVersion: null });
    // A save on another screen never touches the version.
    const other = await screen('stories');
    const elsewhere = await saveStrings(getPool(), LAN, other.input({ 'stories.title': 'Kitchen Stories' }));
    expect(elsewhere.ok && elsewhere.data.policyVersion).toBeNull();
    expect((await currentPolicyVersion(getPool())).version).toBe(second.ok ? second.data.policyVersion : '');
  });

  it('putting every agreed text back to the registry defaults returns to the seeded hash, still as a new version', async () => {
    let s = await screen('legal');
    await saveStrings(getPool(), LAN, s.input({ 'legal.title': 'Privacy' }));
    s = await screen('legal');
    const back = await saveStrings(getPool(), LAN, s.input({ 'legal.title': REGISTRY['legal.title'].en }));
    // The text equals the seeded wording again, but the newest row is "Privacy": a version moves forward, never back.
    expect(back.ok && back.data.policyVersion).toMatch(/\.2$/);
    const { sha256 } = await currentPolicyVersion(getPool());
    expect(sha256).toBe('f49aa3f58723d14d6491c1801466c411fe9439acab85b4da5272d4c7676e10d2');
  });

  it('two policy saves at once: the one that commits last is the version in force, even when its transaction began first', async () => {
    // Mai's save begins (and so does its now()), then Lan's whole save runs and commits before Mai's reaches the version.
    const mai = await getPool().connect();
    try {
      await mai.query('BEGIN');
      await mai.query('SELECT now()');
      const lan = await saveStrings(getPool(), LAN, (await screen('legal')).input({ 'legal.title': 'Privacy notice' }));
      expect(lan.ok && lan.data.policyVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      await mai.query(`INSERT INTO content_strings (key, locale, value, updated_by) VALUES ('booking.consent', 'en', 'I agree to the privacy notice.', 'staff-mai')`);
      const maiVersion = await recordPolicyVersion(mai, MAI);
      await mai.query('COMMIT');
      expect(maiVersion).toMatch(/\.2$/);

      // Mai's row holds the wording in force (both edits): it is the newest, for the policy page and for bookings (create.ts orders alike).
      const { defaultLocale, rows } = await loadStringRows('en', AGREED_KEYS);
      expect(await currentPolicyVersion(getPool())).toMatchObject({ version: maiVersion, sha256: policyTextHash(resolveStrings(rows, AGREED_KEYS, 'en', defaultLocale)) });
    } finally {
      await mai.query('ROLLBACK').catch(() => {});
      mai.release();
    }
  });

  it('the offers screen words the cards’ prices: the offers loader reads its templates (LOADERS.offers carries content:ui)', async () => {
    const s = await screen('offers');
    const saved = await saveStrings(getPool(), LAN, s.input({ 'offers.price_plus_plus': 'From {currency} {amount}++' }));
    expect(saved).toEqual({ ok: true, data: { changed: ['offers.price_plus_plus'], policyVersion: null } });
    expect((await loadOffers('en')).map((o) => o.detail)).toEqual([
      'From VND 888,000++ · Nightly 18:30–22:00',
      'From VND 799,000++ · Daily 11:00 or 14:00',
      'VND 450,000 net per guest · ~30 pastries, 12+ teas',
    ]);
    // A template that drops {amount} is refused like any variable change (spec §7.4).
    const refused = await saveStrings(getPool(), LAN, (await screen('offers')).input({ 'offers.price_net': '{currency} net' }));
    expect(refused).toMatchObject({ ok: false, code: 'invalid', fieldErrors: { 'v:offers.price_net': [expect.stringContaining('{amount}')] } });
  });

  it('History restores a key: the version before an edit (the default deletes the row), then the edit again; a stale token is a conflict', async () => {
    let s = await screen('stories');
    await saveStrings(getPool(), LAN, s.input({ 'stories.title': 'Kitchen Stories' }));
    const [edit] = await loadScreenHistory(getPool(), 'stories');
    expect(edit).toMatchObject({ key: 'stories.title', action: 'create', before: { value: REGISTRY['stories.title'].en }, after: { value: 'Kitchen Stories' } });
    const token = (await loadScreenStrings(getPool(), 'stories')).find((f) => f.key === 'stories.title')!.token;

    // Before the edit: the registry default, so the row goes (R20).
    expect(await restoreString(getPool(), MAI, { key: 'stories.title', auditId: edit.id, side: 'before', token })).toEqual({
      ok: true,
      data: { changed: ['stories.title'], policyVersion: null },
    });
    expect(await guestSees('stories.title')).toBe(REGISTRY['stories.title'].en);
    expect(await query(`SELECT 1 FROM content_strings`)).toEqual([]);
    const [restored] = await loadScreenHistory(getPool(), 'stories');
    expect(restored).toMatchObject({ action: 'restore', actor: 'Mai', after: { value: REGISTRY['stories.title'].en, overridden: false, meta: { restored_from: edit.id } } });

    // The edit again, from the same row's after; a page that still holds the old token is refused.
    expect(await restoreString(getPool(), LAN, { key: 'stories.title', auditId: edit.id, side: 'after', token })).toMatchObject({ ok: false, code: 'conflict' });
    expect(await restoreString(getPool(), LAN, { key: 'stories.title', auditId: edit.id, side: 'after', token: '' })).toMatchObject({ ok: true });
    expect(await guestSees('stories.title')).toBe('Kitchen Stories');
    // Another key's row cannot restore this one.
    expect(await restoreString(getPool(), LAN, { key: 'stories.lede', auditId: edit.id, side: 'after', token: '' })).toEqual({ ok: false, code: 'not_found' });
  });

  it('History is per language: another language’s row of the same key is neither listed nor restored into EN', async () => {
    const { rows } = await getPool().query<{ id: string }>(
      `INSERT INTO audit_log (action, entity_type, entity_id, locale, before, after)
       VALUES ('update', 'content_strings', 'stories.title', 'vi', '{"value":"Câu chuyện","overridden":true}', '{"value":"Chuyện bếp","overridden":true}')
       RETURNING id::text`,
    );
    expect(await loadScreenHistory(getPool(), 'stories')).toEqual([]);
    expect(await restoreString(getPool(), LAN, { key: 'stories.title', auditId: rows[0].id, side: 'after', token: '' })).toEqual({ ok: false, code: 'not_found' });
    expect(await query(`SELECT 1 FROM content_strings`)).toEqual([]);
  });

  it('a restore checks the old text against today’s registry (code rule 5), and a legal key moves the policy version', async () => {
    const { rows } = await getPool().query<{ id: string }>(
      `INSERT INTO audit_log (action, entity_type, entity_id, locale, before, after)
       VALUES ('update', 'content_strings', 'search.none', 'en', '{"value":"Nothing found.","overridden":true}', '{"value":"No match for {query}","overridden":true}')
       RETURNING id::text`,
    );
    // search.none declares {query}: the old "Nothing found." would drop it.
    const refused = await restoreString(getPool(), LAN, { key: 'search.none', auditId: rows[0].id, side: 'before', token: '' });
    expect(refused).toMatchObject({ ok: false, code: 'invalid', fieldErrors: { 'v:search.none': [expect.stringContaining('{query}')] } });
    expect(await query(`SELECT 1 FROM content_strings`)).toEqual([]);

    let s = await screen('legal');
    await saveStrings(getPool(), LAN, s.input({ 'legal.title': 'Privacy notice' }));
    const [edit] = await loadScreenHistory(getPool(), 'legal');
    const token = (await loadScreenStrings(getPool(), 'legal')).find((f) => f.key === 'legal.title')!.token;
    const back = await restoreString(getPool(), LAN, { key: 'legal.title', auditId: edit.id, side: 'before', token });
    expect(back.ok && back.data.policyVersion).toMatch(/\.2$/);
    s = await screen('legal');
    expect(s.fields.find((f) => f.key === 'legal.title')).toMatchObject({ value: REGISTRY['legal.title'].en, overridden: false });
  });

  it('tags (R6): policy page keys → content:legal; every other guest key → content:ui; email keys none (read uncached)', () => {
    expect(tagsForStrings(['legal.title'])).toEqual([TAGS.contentLegal]);
    expect(tagsForStrings(['legal.link', 'stories.title', 'offers.price_net'])).toEqual([TAGS.contentUi]);
    expect(tagsForStrings(['booking.consent'], true).sort()).toEqual([TAGS.contentLegal, TAGS.contentUi].sort());
    expect(tagsForStrings(['email.guest.ack.subject'])).toEqual([]);
  });
});
