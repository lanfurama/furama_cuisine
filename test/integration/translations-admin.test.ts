import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, query } from '@/db/client';
import { REGISTRY } from '@/lib/i18n/registry';
import { coverage, coverageSummary, reviewQueue, reviewTranslations } from '@/lib/server/content-admin/translations';
import { saveStrings, loadScreenStrings, stringSource } from '@/lib/server/content/strings-admin';
import { sourceHash } from '@/lib/i18n/source-hash';

/*
 * Phase 8 C10: /admin/translations. Coverage per kind and language, one row
 * in each state; the review queue (machine translations, "EN đã đổi"); "Duyệt"
 * and "Vẫn đúng" keep the text and write the bookkeeping, with a History row;
 * a stale token is a conflict. Machine rows are written by SQL: no phase-8
 * flow writes one (L9-1).
 */

const LAN = { id: 'staff-lan', email: 'lan@furama.test' };
const pool = getPool();

/** Offers 1–3 of the seed get one Vietnamese row each: reviewed and current, machine, and out of date. */
async function seed() {
  const en = await query<{ offer_id: string; title: string; schedule: string | null; venue_override: string | null }>(
    `SELECT offer_id::text, title, schedule, venue_override FROM offer_i18n WHERE locale = 'en' AND offer_id IN (1, 2, 3) ORDER BY offer_id`,
  );
  const current = (id: string) => sourceHash(['title', 'schedule', 'venue_override'], en.find((r) => r.offer_id === id));
  await query(`INSERT INTO offer_i18n (offer_id, locale, title, status, origin, source_hash) VALUES (1, 'vi', 'Đã duyệt', 'reviewed', 'human', $1)`, [current('1')]);
  await query(`INSERT INTO offer_i18n (offer_id, locale, title, status, origin, ai_model, source_hash) VALUES (2, 'vi', 'Máy dịch', 'machine', 'ai', 'm', $1)`, [current('2')]);
  await query(`INSERT INTO offer_i18n (offer_id, locale, title, status, origin, source_hash) VALUES (3, 'vi', 'Cũ', 'reviewed', 'human', 'old')`);
}

const token = async (id: number) =>
  (await query<{ token: string }>(`SELECT (extract(epoch FROM updated_at) * 1000000)::bigint::text AS token FROM offer_i18n WHERE offer_id = $1 AND locale = 'vi'`, [id]))[0]
    .token;

describe.skipIf(!process.env.TEST_DATABASE_URL)('/admin/translations (database)', () => {
  beforeEach(async () => {
    await query(`DELETE FROM offer_i18n WHERE locale <> 'en'`);
    await query(`DELETE FROM content_strings`);
    await query(`DELETE FROM audit_log WHERE entity_type IN ('offers', 'content_strings')`);
    await query(`DELETE FROM staff_user WHERE id = 'staff-lan'`);
    await query(`INSERT INTO staff_user (id, name, email, email_verified, role) VALUES ('staff-lan', 'Lan', 'lan@furama.test', true, 'editor')`);
  });
  afterAll(async () => {
    await query(`DELETE FROM offer_i18n WHERE locale <> 'en'`);
    await query(`DELETE FROM content_strings`);
    await query(`DELETE FROM staff_user WHERE id = 'staff-lan'`);
    await pool.end();
  });

  it('counts each state per kind and language, over what has English text', async () => {
    await seed();
    const { locales, kinds } = await coverage(pool);
    expect(locales.map((l) => l.code)).toEqual(['vi']);
    const offers = kinds.find((k) => k.key === 'offers')!.cells.vi;
    const total = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM offer_i18n WHERE locale = 'en' AND title <> ''`))[0].n;
    expect(offers).toEqual({ total, reviewed: 1, machine: 1, stale: 1, missing: total - 3 });
    // The registry's own Vietnamese counts as reviewed: every email key has one.
    const emails = kinds.find((k) => k.key === 'strings:emails')!.cells.vi;
    expect(emails.reviewed).toBe(emails.total);
    const [vi] = await coverageSummary(pool);
    expect(vi).toMatchObject({ code: 'vi', stale: 1 });
  });

  it('queues machine and out-of-date rows, with their English, and filters by language and kind', async () => {
    await seed();
    const { items, total } = await reviewQueue(pool, { locale: 'vi', kind: 'offers' });
    expect(total).toBe(2);
    expect(items.map((i) => [i.id, i.reason, i.translation])).toEqual([
      ['2', 'machine', 'Máy dịch'],
      ['3', 'stale', 'Cũ'],
    ]);
    expect(items[0]).toMatchObject({ kind: 'offers', locale: 'vi', href: '/admin/content/offers/2', reviewable: true });
    expect((await reviewQueue(pool, { kind: 'cuisines' })).total).toBe(0);
  });

  it('"Duyệt" makes a machine row reviewed, keeps its text, and leaves a History row; "Vẫn đúng" clears "EN đã đổi"', async () => {
    await seed();
    const result = await reviewTranslations(pool, LAN, [
      { kind: 'offers', id: '2', locale: 'vi', token: await token(2) },
      { kind: 'offers', id: '3', locale: 'vi', token: await token(3) },
    ]);
    expect(result).toEqual({ ok: true, data: { tables: ['offers', 'offer_i18n'], keys: [] } });
    expect(await query(`SELECT offer_id::int AS id, title, status, reviewed_by FROM offer_i18n WHERE locale = 'vi' ORDER BY offer_id`)).toEqual([
      { id: 1, title: 'Đã duyệt', status: 'reviewed', reviewed_by: null },
      { id: 2, title: 'Máy dịch', status: 'reviewed', reviewed_by: 'staff-lan' },
      { id: 3, title: 'Cũ', status: 'reviewed', reviewed_by: 'staff-lan' },
    ]);
    expect((await reviewQueue(pool, { locale: 'vi', kind: 'offers' })).total).toBe(0);
    const audit = await query<{ entity_id: string; locale: string; before: { i18n: { locale: string; status: string }[] } }>(
      `SELECT entity_id, locale, before FROM audit_log WHERE entity_type = 'offers' ORDER BY entity_id`,
    );
    expect(audit.map((a) => [a.entity_id, a.locale])).toEqual([
      ['2', 'vi'],
      ['3', 'vi'],
    ]);
    expect(audit[0].before.i18n.find((t) => t.locale === 'vi')?.status).toBe('machine');
  });

  it('a stale token is a conflict, and nothing of the batch is written', async () => {
    await seed();
    const fresh = await token(2);
    const result = await reviewTranslations(pool, LAN, [
      { kind: 'offers', id: '2', locale: 'vi', token: fresh },
      { kind: 'offers', id: '3', locale: 'vi', token: '1' },
    ]);
    expect(result).toMatchObject({ ok: false, code: 'conflict' });
    expect(await query(`SELECT status FROM offer_i18n WHERE offer_id = 2 AND locale = 'vi'`)).toEqual([{ status: 'machine' }]);
  });

  it('a string translation is reviewed too, and the queue links to its screen in that language', async () => {
    const fields = await loadScreenStrings(pool, 'stories', 'vi');
    await saveStrings(pool, LAN, {
      screen: 'stories',
      locale: 'vi',
      values: { 'stories.title': 'Chuyện bếp' },
      originals: Object.fromEntries(fields.map((f) => [f.key, f.value])),
      tokens: Object.fromEntries(fields.map((f) => [f.key, f.token])),
    });
    await query(`UPDATE content_strings SET status = 'machine' WHERE key = 'stories.title' AND locale = 'vi'`);
    const [queued] = (await reviewQueue(pool, { kind: 'strings:stories' })).items;
    expect(queued).toMatchObject({ id: 'stories.title', reason: 'machine', href: '/admin/content/stories?lang=vi#strings-stories' });
    expect(await reviewTranslations(pool, LAN, [{ kind: 'strings:stories', id: 'stories.title', locale: 'vi', token: queued.token }])).toEqual({
      ok: true,
      data: { tables: [], keys: ['stories.title'] },
    });
    expect(await query(`SELECT status, source_hash FROM content_strings WHERE key = 'stories.title'`)).toEqual([
      { status: 'reviewed', source_hash: stringSource(REGISTRY['stories.title'].en) },
    ]);
  });

  it('refuses a kind it does not review (closures: their own screen) and more than 50 rows', async () => {
    expect(await reviewTranslations(pool, LAN, [{ kind: 'closure', id: '1', locale: 'vi', token: '' }])).toEqual({ ok: false, code: 'not_found' });
    const many = Array.from({ length: 51 }, (_, i) => ({ kind: 'offers', id: String(i), locale: 'vi', token: '' }));
    expect(await reviewTranslations(pool, LAN, many)).toMatchObject({ ok: false, code: 'invalid' });
  });
});
