import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool } from '@/db/client';
import type { AuditActor } from '@/lib/server/audit';
import { formLocales, itemStates } from '@/lib/server/content-admin/form-locales';
import { getOfferEditor, OFFER, restoreOffer, updateOffer } from '@/lib/server/content-admin/offers';
import { readItem } from '@/lib/server/content-admin/snapshot';
import { TEST_DATABASE_URL } from '../helpers/db';

/*
 * Phase 8 (spec §5.1 item 3, C8): a form posts every language's tab, and a
 * save writes only the languages whose text changed, so "EN đã đổi" means
 * something. Offer 2 of the seed, with a Vietnamese tab.
 */

const pool = getPool();
const ACTOR: AuditActor = { id: 'staff-lan', email: 'lan@furama.test', name: 'Lan' };
const ID = '2';

const editor = async () => (await getOfferEditor(pool, ID))!;
const states = async () => itemStates(OFFER, (await readItem(pool, OFFER, ID))!, await formLocales(pool));
const vi = async () =>
  (await pool.query(`SELECT title, status, origin, source_hash, updated_by FROM offer_i18n WHERE offer_id = $1 AND locale = 'vi'`, [ID])).rows[0];
async function save(change: (values: Awaited<ReturnType<typeof editor>>['values']) => object, actor = ACTOR) {
  const e = await editor();
  return updateOffer(pool, actor, ID, e.token, { ...e.values, ...change(e.values) });
}

/** The seed's English row of the offer, put back before each test and after the last, so later files read the seed. */
let english: { title: string; schedule: string | null; venue_override: string | null } | undefined;
async function putBack() {
  await pool.query(`DELETE FROM offer_i18n WHERE offer_id = $1 AND locale <> 'en'`, [ID]);
  english ??= (await pool.query(`SELECT title, schedule, venue_override FROM offer_i18n WHERE offer_id = $1 AND locale = 'en'`, [ID])).rows[0];
  await pool.query(`UPDATE offer_i18n SET title = $2, schedule = $3, venue_override = $4 WHERE offer_id = $1 AND locale = 'en'`, [
    ID,
    english!.title,
    english!.schedule,
    english!.venue_override,
  ]);
}

describe.skipIf(!TEST_DATABASE_URL)('saving translations (database)', () => {
  beforeEach(putBack);
  afterAll(putBack);

  it('starts with the Vietnamese tab missing; a Vietnamese save writes it reviewed, with the English fingerprint', async () => {
    expect((await states()).vi).toBe('missing');
    expect(await save((v) => ({ title: { ...v.title, vi: 'Lớp nấu ăn' } }))).toMatchObject({ ok: true });
    expect(await vi()).toMatchObject({ title: 'Lớp nấu ăn', status: 'reviewed', origin: 'human', updated_by: ACTOR.id, source_hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(await states()).toMatchObject({ en: 'reviewed', vi: 'reviewed' });
  });

  it('an English edit leaves the Vietnamese row as it was, and so out of date; saving it again brings it up to date', async () => {
    await save((v) => ({ title: { ...v.title, vi: 'Lớp nấu ăn' } }));
    const before = await vi();
    expect(await save((v) => ({ title: { ...v.title, en: 'Cooking Class with Chef Hép' } }))).toMatchObject({ ok: true });
    expect(await vi()).toEqual(before);
    expect((await states()).vi).toBe('stale');

    expect(await save((v) => ({ title: { ...v.title, vi: 'Lớp nấu ăn với bếp trưởng Hép' } }))).toMatchObject({ ok: true });
    expect((await states()).vi).toBe('reviewed');
  });

  it('a machine translation stays one through a save that does not touch it', async () => {
    await pool.query(`INSERT INTO offer_i18n (offer_id, locale, title, status, origin, ai_model) VALUES ($1, 'vi', 'Máy dịch', 'machine', 'ai', 'test-model')`, [ID]);
    await save((v) => ({ schedule: { ...v.schedule, en: 'Daily 11:00' } }));
    expect(await vi()).toMatchObject({ title: 'Máy dịch', status: 'machine', origin: 'ai' });
    expect((await states()).vi).toBe('machine');
  });

  it('a Vietnamese tab emptied deletes its row ("use English"); an empty tab never creates one', async () => {
    await save((v) => ({ title: { ...v.title, vi: 'Lớp nấu ăn' } }));
    await save((v) => ({ title: { ...v.title, vi: null } }));
    expect(await vi()).toBeUndefined();
    await save((v) => ({ title: { ...v.title, vi: null } }));
    expect(await vi()).toBeUndefined();
  });

  it('a restore puts back each language’s row with its status and fingerprint (R3)', async () => {
    await save((v) => ({ title: { ...v.title, vi: 'Lớp nấu ăn' } }));
    const saved = await vi();
    await save((v) => ({ title: { ...v.title, vi: 'Khác' } }));
    // ORDER BY the bigint, not its text: '9' sorts after '10'.
    const { rows } = await pool.query(`SELECT a.id::text AS id FROM audit_log a WHERE entity_type = 'offers' AND entity_id = $1 ORDER BY a.id DESC LIMIT 1`, [ID]);
    expect(await restoreOffer(pool, ACTOR, { id: ID, auditId: rows[0].id, side: 'before', token: (await editor()).token })).toMatchObject({ ok: true });
    expect(await vi()).toMatchObject({ title: 'Lớp nấu ăn', status: saved.status, source_hash: saved.source_hash });
  });
});

describe.skipIf(!TEST_DATABASE_URL)('closure reasons and alt text per language (database)', () => {
  it('an edit of a closure that posts English and Vietnamese keeps its Korean reason, and an emptied English one goes (phase-4 T13)', async () => {
    const { createClosure, listClosures, updateClosure } = await import('@/lib/server/booking/config');
    await pool.query(`INSERT INTO locales (code, bcp47, native_name, short_label, script, sort_order) VALUES ('ko', 'ko', '한국어', 'KO', 'hangul', 30) ON CONFLICT DO NOTHING`);
    try {
      const input = {
        scope: 'restaurant' as const,
        destinationId: null,
        restaurantId: 'taya-house',
        startsOn: '2030-01-05' as const,
        endsOn: '2030-01-05' as const,
        meals: null,
        showReason: true,
        publicReason: { en: 'Private event', vi: 'Sự kiện riêng' },
        internalNote: null,
      };
      const { data } = await createClosure(pool, ACTOR, input);
      await pool.query(`INSERT INTO closure_i18n (closure_id, locale, public_reason, status, origin) VALUES ($1, 'ko', '비공개 행사', 'machine', 'ai')`, [data.id]);
      const view = (await listClosures(pool, '2030-01-01')).find((c) => c.id === data.id)!;
      expect(await updateClosure(pool, ACTOR, { ...input, id: data.id, token: view.token, publicReason: { en: '', vi: 'Sự kiện riêng tư' } })).toMatchObject({ ok: true });
      const rows = (await pool.query(`SELECT locale, public_reason, status FROM closure_i18n WHERE closure_id = $1 ORDER BY locale`, [data.id])).rows;
      expect(rows).toEqual([
        { locale: 'ko', public_reason: '비공개 행사', status: 'machine' },
        { locale: 'vi', public_reason: 'Sự kiện riêng tư', status: 'reviewed' },
      ]);
      await pool.query(`DELETE FROM closures WHERE id = $1`, [data.id]);
    } finally {
      await pool.query(`DELETE FROM locales WHERE code = 'ko'`);
    }
  });

  it('a file’s Vietnamese alt is saved beside its English one, and emptied it goes', async () => {
    const { getMedia, saveMediaDetails } = await import('@/lib/server/media/library');
    const { rows } = await pool.query(`SELECT m.id::text FROM media m JOIN media_i18n a ON a.media_id = m.id AND a.locale = 'en' WHERE m.deleted_at IS NULL LIMIT 1`);
    const id = rows[0].id as string;
    const item = (await getMedia(pool, id))!;
    expect(await saveMediaDetails(pool, ACTOR, { id, token: item.token, alt: item.alt, decorative: item.isDecorative, translations: { vi: 'Ảnh bãi biển' } })).toMatchObject({ ok: true });
    const viAlt = async () => (await pool.query(`SELECT alt, status, source_hash FROM media_i18n WHERE media_id = $1 AND locale = 'vi'`, [id])).rows[0];
    expect(await viAlt()).toMatchObject({ alt: 'Ảnh bãi biển', status: 'reviewed', source_hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const again = (await getMedia(pool, id))!;
    expect(await saveMediaDetails(pool, ACTOR, { id, token: again.token, alt: again.alt, decorative: again.isDecorative, translations: { vi: '' } })).toMatchObject({ ok: true });
    expect(await viAlt()).toBeUndefined();
  });
});
