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

let originalTitle: string;

describe.skipIf(!TEST_DATABASE_URL)('saving translations (database)', () => {
  beforeEach(async () => {
    await pool.query(`DELETE FROM offer_i18n WHERE offer_id = $1 AND locale <> 'en'`, [ID]);
    originalTitle ??= (await editor()).values.title.en!;
    await pool.query(`UPDATE offer_i18n SET title = $2 WHERE offer_id = $1 AND locale = 'en'`, [ID, originalTitle]);
  });
  afterAll(async () => {
    await pool.query(`DELETE FROM offer_i18n WHERE offer_id = $1 AND locale <> 'en'`, [ID]);
    await pool.query(`UPDATE offer_i18n SET title = $2 WHERE offer_id = $1 AND locale = 'en'`, [ID, originalTitle]);
  });

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
