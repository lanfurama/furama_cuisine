import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, query } from '@/db/client';
import { TAGS } from '@/lib/cache-tags';
import { REGISTRY } from '@/lib/i18n/registry';
import { loadScreenStrings, saveStrings, tagsForStrings, type StringsInput } from '@/lib/server/content/strings-admin';
import { loadOffers } from '@/lib/server/content/home.queries';
import { loadStringRows } from '@/lib/server/content/strings.queries';
import { resolveStrings } from '@/lib/i18n/resolve';

/*
 * The content_strings editor's save (spec §7.4, §7.5, §11): validation against
 * the registry, one row per changed key, audit rows that can restore, tokens
 * per key, and "Khôi phục mặc định" deleting the row.
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
    await query(`DELETE FROM audit_log WHERE entity_type = 'content_strings'`);
    await query(`DELETE FROM staff_user WHERE id IN ('staff-lan', 'staff-mai')`);
    await query(
      `INSERT INTO staff_user (id, name, email, email_verified, role) VALUES
         ('staff-lan', 'Lan', 'lan@furama.test', true, 'editor'), ('staff-mai', 'Mai', 'mai@furama.test', true, 'editor')`,
    );
  });
  afterAll(async () => {
    await query('DELETE FROM content_strings');
    await query(`DELETE FROM staff_user WHERE id IN ('staff-lan', 'staff-mai')`);
    await getPool().end();
  });

  it('saves only the changed key, as reviewed/human, with an audit row holding both sides', async () => {
    const s = await screen('stories');
    const result = await saveStrings(getPool(), LAN, s.input({ 'stories.title': 'Kitchen Stories', 'stories.lede': REGISTRY['stories.lede'].en }));
    expect(result).toEqual({ ok: true, data: { changed: ['stories.title'] } });
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

  it('the offers screen words the cards’ prices: the offers loader reads its templates (LOADERS.offers carries content:ui)', async () => {
    const s = await screen('offers');
    const saved = await saveStrings(getPool(), LAN, s.input({ 'offers.price_plus_plus': 'From {currency} {amount}++' }));
    expect(saved).toEqual({ ok: true, data: { changed: ['offers.price_plus_plus'] } });
    expect((await loadOffers('en')).map((o) => o.detail)).toEqual([
      'From VND 888,000++ · Nightly 18:30–22:00',
      'From VND 799,000++ · Daily 11:00 or 14:00',
      'VND 450,000 net per guest · ~30 pastries, 12+ teas',
    ]);
    // A template that drops {amount} is refused like any variable change (spec §7.4).
    const refused = await saveStrings(getPool(), LAN, (await screen('offers')).input({ 'offers.price_net': '{currency} net' }));
    expect(refused).toMatchObject({ ok: false, code: 'invalid', fieldErrors: { 'v:offers.price_net': [expect.stringContaining('{amount}')] } });
  });

  it('tags (R6): policy page keys → content:legal; every other guest key → content:ui; email keys none (read uncached)', () => {
    expect(tagsForStrings(['legal.title'])).toEqual([TAGS.contentLegal]);
    expect(tagsForStrings(['legal.link', 'stories.title', 'offers.price_net'])).toEqual([TAGS.contentUi]);
    expect(tagsForStrings(['email.guest.ack.subject'])).toEqual([]);
  });
});
