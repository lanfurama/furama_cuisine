import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool } from '@/db/client';
import { restoreChoices } from '@/lib/admin/history';
import type { AuditActor } from '@/lib/server/audit';
import { listDeleted, listHistory } from '@/lib/server/content-admin/history';
import {
  createOffer,
  deleteOffer,
  getOfferEditor,
  listOffersAdmin,
  OFFER,
  reorderOffers,
  restoreOffer,
  restoreOfferOrder,
  setOfferPublished,
  updateOffer,
  type OfferInput,
} from '@/lib/server/content-admin/offers';
import { readItem, snapshotToken, writeItem, type ItemDef, type ItemSnapshot } from '@/lib/server/content-admin/snapshot';
import { loadOffers } from '@/lib/server/content/home.queries';

/*
 * Spec §7.4 and §7.5 on the offers list, the first editor of the shared
 * engine (makeListEditor): create, edit, show/hide, reorder, delete,
 * restore. Each save is one transaction with before/after snapshots that hold
 * the main row and every *_i18n row, so the guest's next read has the change
 * and a deleted item comes back whole, under its id.
 * ACCEPTANCE (spec §14.1 row 7, AC4): edit then delete an offer, and restore
 * it both times.
 */

/** A save's answer: the token of the version it wrote (Saved, lib/admin/save-state.ts). */
const SAVED = { ok: true, data: { token: expect.any(String) } };
const pool = getPool();
const ACTOR: AuditActor = { id: 'staff-mai', email: 'mai@furama.test', name: 'Mai' };
const OTHER: AuditActor = { id: 'staff-tuan', email: 'tuan@furama.test', name: 'Tuấn' };

let seedOffers: ItemSnapshot[] = [];

const titles = async () => (await loadOffers('en')).map((o) => o.title);
const offerToken = async (id: string) => (await getOfferEditor(pool, id))!.token;
const audit = async () =>
  (await pool.query('SELECT a.id::text AS id, actor_id, action, entity_type, entity_id, locale, before, after FROM audit_log a ORDER BY a.id')).rows;

function offerInput(over: Partial<OfferInput> = {}): OfferInput {
  return {
    restaurantId: 'taya-house',
    priceAmount: '500000',
    currency: 'VND',
    priceBasis: 'net',
    validFrom: null,
    validUntil: null,
    isPublished: true,
    title: { en: 'Sunset Set Menu' },
    schedule: { en: 'Daily 17:00–19:00' },
    venueOverride: { en: null },
    ...over,
  };
}

/** Puts the offers back as migration 008 seeded them. */
async function resetOffers() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE reservations SET offer_id = NULL WHERE offer_id IS NOT NULL');
    await client.query('DELETE FROM offers');
    for (const s of seedOffers) await writeItem(client, OFFER, s, 'seed');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('content editors: save flow, history and restore (database)', () => {
  beforeAll(async () => {
    seedOffers = await Promise.all(['1', '2', '3'].map(async (id) => (await readItem(pool, OFFER, id))!));
    for (const a of [ACTOR, OTHER]) {
      await pool.query(`INSERT INTO staff_user (id, name, email, email_verified, role) VALUES ($1, $2, $3, true, 'editor') ON CONFLICT (id) DO NOTHING`, [
        a.id,
        a.name,
        a.email,
      ]);
    }
  });
  beforeEach(() => pool.query('TRUNCATE audit_log'));
  afterEach(() => resetOffers());
  afterAll(async () => {
    await pool.query('TRUNCATE audit_log');
    await pool.query(`DELETE FROM staff_user WHERE id = ANY($1::text[])`, [[ACTOR.id, OTHER.id]]);
    await pool.end();
  });

  describe('offers', () => {
    it('ACCEPTANCE: edit an offer, restore the version before; delete it, restore it; the guest list follows each step', async () => {
      try {
        expect(await titles()).toEqual(['Seafood & Steak Buffet Dinner', 'Vietnamese Cooking Class', 'Afternoon Tea & Dessert Buffet']);

        // Edit.
        const input = { ...(await getOfferEditor(pool, '2'))!.values, title: { en: 'Cooking Class with Chef Hép' } };
        expect(await updateOffer(pool, ACTOR, '2', await offerToken('2'), input)).toEqual(SAVED);
        expect(await titles()).toEqual(['Seafood & Steak Buffet Dinner', 'Cooking Class with Chef Hép', 'Afternoon Tea & Dessert Buffet']);
        const [edit] = await audit();
        expect(edit).toMatchObject({ actor_id: ACTOR.id, action: 'update', entity_type: 'offers', entity_id: '2' });
        // Both snapshots hold the main row and every i18n row.
        expect(edit.before).toMatchObject({ v: 1, row: { id: 2, restaurant_id: 'taya-house' }, i18n: [{ locale: 'en', title: 'Vietnamese Cooking Class' }] });
        expect(edit.after.i18n).toEqual([expect.objectContaining({ locale: 'en', title: 'Cooking Class with Chef Hép', status: 'reviewed', origin: 'human' })]);

        // History offers the version before the edit (the seed) and nothing for the current one.
        const history = await listHistory(pool, 'offers', '2');
        expect(restoreChoices(history, await offerToken('2'), snapshotToken)).toEqual([[{ side: 'before', label: 'Khôi phục bản trước lần này' }]]);

        // Restore 1: the version before the edit.
        expect(await restoreOffer(pool, ACTOR, { id: '2', auditId: edit.id, side: 'before', token: await offerToken('2') })).toEqual({ ok: true, data: null });
        expect(await titles()).toEqual(['Seafood & Steak Buffet Dinner', 'Vietnamese Cooking Class', 'Afternoon Tea & Dessert Buffet']);
        const restored = (await audit()).at(-1);
        expect(restored).toMatchObject({ action: 'restore', entity_id: '2', before: { i18n: [{ title: 'Cooking Class with Chef Hép' }] } });
        expect(restored.after).toMatchObject({ i18n: [{ title: 'Vietnamese Cooking Class' }], meta: { restored_from: edit.id } });

        // Delete, with a booking that took the offer: the booking keeps everything but the link (phase-6 R5).
        const { rows } = await pool.query<{ id: string }>(
          `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, phone_e164, status, meal, source, offer_id, note)
           VALUES ('FC-OFFER02', 'taya-house', '2026-12-01', '11:00', 2, 'Khách', '+84905111222', '+84905111222', 'confirmed', 'Lunch', 'web', 2, 'Offer: Vietnamese Cooking Class')
           RETURNING id::text`,
        );
        expect(await deleteOffer(pool, ACTOR, '2', await offerToken('2'))).toEqual({ ok: true, data: { meta: { unlinked_reservations: [rows[0].id] } } });
        expect(await titles()).toEqual(['Seafood & Steak Buffet Dinner', 'Afternoon Tea & Dessert Buffet']);
        expect(await getOfferEditor(pool, '2')).toBeNull();
        const booking = (await pool.query('SELECT offer_id, note, version FROM reservations WHERE id = $1', [rows[0].id])).rows[0];
        expect(booking).toEqual({ offer_id: null, note: 'Offer: Vietnamese Cooking Class', version: 2 });
        // R9: the booking's timeline says why its version moved, and who did it (L7-12).
        const events = (await pool.query(`SELECT actor_kind, actor_id, actor_label, type, changes FROM reservation_events WHERE reservation_id = $1 ORDER BY id`, [rows[0].id])).rows;
        expect(events).toEqual([
          { actor_kind: 'staff', actor_id: ACTOR.id, actor_label: 'Mai (mai@furama.test)', type: 'edited', changes: { offer: ['Vietnamese Cooking Class', null] } },
        ]);
        const del = (await audit()).at(-1);
        expect(del).toMatchObject({ action: 'delete', entity_id: '2', after: null, before: { row: { id: 2 }, meta: { unlinked_reservations: [rows[0].id] } } });
        expect(del.before.i18n).toEqual([expect.objectContaining({ locale: 'en', title: 'Vietnamese Cooking Class', schedule: 'Daily 11:00 or 14:00' })]);
        expect((await listDeleted(pool, OFFER)).map((d) => d.id)).toEqual(['2']);

        // Restore 2: the deleted offer, under its own id and in its old place; the booking is not relinked (R5).
        const choices = restoreChoices(await listHistory(pool, 'offers', '2'), 'deleted', snapshotToken);
        expect(choices[0]).toEqual([{ side: 'before', label: 'Khôi phục mục đã xóa' }]);
        expect(await restoreOffer(pool, ACTOR, { id: '2', auditId: del.id, side: 'before', token: 'deleted' })).toEqual({ ok: true, data: null });
        expect(await titles()).toEqual(['Seafood & Steak Buffet Dinner', 'Vietnamese Cooking Class', 'Afternoon Tea & Dessert Buffet']);
        expect((await loadOffers('en'))[1]).toMatchObject({ id: 2, restaurantId: 'taya-house', detail: 'VND 799,000++ per guest · Daily 11:00 or 14:00' });
        expect((await pool.query('SELECT offer_id FROM reservations WHERE id = $1', [rows[0].id])).rows[0].offer_id).toBeNull();
        expect((await pool.query('SELECT count(*)::int AS n FROM reservation_events WHERE reservation_id = $1', [rows[0].id])).rows[0].n).toBe(1);
        expect(await listDeleted(pool, OFFER)).toEqual([]);

        // The same delete row restored twice: the offer exists now, so the page's 'deleted' token is stale.
        expect(await restoreOffer(pool, ACTOR, { id: '2', auditId: del.id, side: 'before', token: 'deleted' })).toMatchObject({ ok: false, code: 'conflict' });
        expect((await audit()).map((a) => a.action)).toEqual(['update', 'restore', 'delete', 'restore']);
      } finally {
        // Clean up even when an assertion above fails: a booking left behind would break the next run's INSERT (unique reference).
        await pool.query(`DELETE FROM reservation_events WHERE reservation_id IN (SELECT id FROM reservations WHERE reference = 'FC-OFFER02')`);
        await pool.query(`DELETE FROM reservations WHERE reference = 'FC-OFFER02'`);
      }
    });

    it('a restore rewrites every language of the snapshot, keeping each one’s review state (R3)', async () => {
      await pool.query(
        `INSERT INTO offer_i18n (offer_id, locale, title, status, origin, ai_model) VALUES (1, 'vi', 'Buffet hải sản', 'machine', 'ai', 'gemini-test')`,
      );
      const withVi = (await readItem(pool, OFFER, '1'))!;
      expect(await deleteOffer(pool, ACTOR, '1', snapshotToken(withVi))).toMatchObject({ ok: true });
      const del = (await audit()).at(-1);
      expect(del.before.i18n.map((r: { locale: string }) => r.locale)).toEqual(['en', 'vi']);
      expect(await restoreOffer(pool, ACTOR, { id: '1', auditId: del.id, side: 'before', token: 'deleted' })).toMatchObject({ ok: true });
      const back = (await pool.query(`SELECT locale, title, status, origin, ai_model FROM offer_i18n WHERE offer_id = 1 ORDER BY locale`)).rows;
      expect(back).toEqual([
        { locale: 'en', title: 'Seafood & Steak Buffet Dinner', status: 'reviewed', origin: 'seed', ai_model: null },
        { locale: 'vi', title: 'Buffet hải sản', status: 'machine', origin: 'ai', ai_model: 'gemini-test' },
      ]);
    });

    it('a save from a page older than someone else’s save is a conflict naming them; nothing is written', async () => {
      const stale = await offerToken('1');
      const values = (await getOfferEditor(pool, '1'))!.values;
      expect(await updateOffer(pool, OTHER, '1', stale, { ...values, schedule: { en: 'Nightly 18:00–22:00' } })).toMatchObject({ ok: true });
      const result = await updateOffer(pool, ACTOR, '1', stale, { ...values, title: { en: 'Mine' } });
      expect(result).toMatchObject({ ok: false, code: 'conflict', params: { by: 'Tuấn' } });
      expect((await titles())[0]).toBe('Seafood & Steak Buffet Dinner');
      expect((await audit()).length).toBe(1);
    });

    it('a restore over a newer edit is a conflict too', async () => {
      await updateOffer(pool, ACTOR, '3', await offerToken('3'), { ...(await getOfferEditor(pool, '3'))!.values, title: { en: 'Tea' } });
      const [edit] = await audit();
      const tokenSeen = await offerToken('3');
      await updateOffer(pool, OTHER, '3', tokenSeen, { ...(await getOfferEditor(pool, '3'))!.values, title: { en: 'High Tea' } });
      expect(await restoreOffer(pool, ACTOR, { id: '3', auditId: edit.id, side: 'before', token: tokenSeen })).toMatchObject({ ok: false, code: 'conflict' });
      expect((await titles())[2]).toBe('High Tea');
    });

    it('spec §6.5: at most 6 offers shown; hidden ones do not count; a restore and the show switch obey it too', async () => {
      const ids: string[] = [];
      for (const n of [4, 5, 6]) {
        const r = await createOffer(pool, ACTOR, offerInput({ title: { en: `Offer ${n}` } }));
        expect(r).toMatchObject({ ok: true });
        if (r.ok) ids.push(r.data.id);
      }
      expect(await titles()).toHaveLength(6);
      expect(await createOffer(pool, ACTOR, offerInput({ title: { en: 'Offer 7' } }))).toEqual({ ok: false, code: 'limit', params: { max: '6' } });
      const hidden = await createOffer(pool, ACTOR, offerInput({ title: { en: 'Offer 7' }, isPublished: false }));
      expect(hidden).toMatchObject({ ok: true });
      const hiddenId = hidden.ok ? hidden.data.id : '';
      expect(await setOfferPublished(pool, ACTOR, hiddenId, await offerToken(hiddenId), true)).toMatchObject({ code: 'limit' });
      // Delete a shown one, fill its place, then its restore would make 7.
      expect(await deleteOffer(pool, ACTOR, ids[0], await offerToken(ids[0]))).toMatchObject({ ok: true });
      const del = (await audit()).at(-1);
      expect(await setOfferPublished(pool, ACTOR, hiddenId, await offerToken(hiddenId), true)).toMatchObject({ ok: true });
      expect(await restoreOffer(pool, ACTOR, { id: ids[0], auditId: del.id, side: 'before', token: 'deleted' })).toMatchObject({ ok: false, code: 'limit' });
      // New offers go to the end; the list says what a guest sees.
      const list = await listOffersAdmin(pool);
      expect(list.items.map((i) => [i.title, i.state])).toEqual([
        ['Seafood & Steak Buffet Dinner', 'shown'],
        ['Vietnamese Cooking Class', 'shown'],
        ['Afternoon Tea & Dessert Buffet', 'shown'],
        ['Offer 5', 'shown'],
        ['Offer 6', 'shown'],
        ['Offer 7', 'shown'],
      ]);
    });

    it('the list says when an offer is not on show today, and why', async () => {
      await pool.query(`UPDATE offers SET valid_until = DATE '2020-01-01' WHERE id = 1`);
      await pool.query(`UPDATE offers SET valid_from = DATE '2099-01-01' WHERE id = 2`);
      await pool.query(`UPDATE offers SET is_published = false WHERE id = 3`);
      expect((await listOffersAdmin(pool)).items.map((i) => i.state)).toEqual(['ended', 'upcoming', 'hidden']);
    });

    it('reorder: the whole old order is kept, a stale list is a conflict, and the old order can be restored', async () => {
      const { token } = await listOffersAdmin(pool);
      expect(await reorderOffers(pool, ACTOR, token, ['3', '1', '2'])).toEqual({ ok: true, data: null });
      expect(await titles()).toEqual(['Afternoon Tea & Dessert Buffet', 'Seafood & Steak Buffet Dinner', 'Vietnamese Cooking Class']);
      const [row] = await audit();
      expect(row).toMatchObject({ action: 'reorder', entity_type: 'offers', entity_id: null });
      expect(row.before.order.map((o: { id: string }) => o.id)).toEqual(['1', '2', '3']);
      expect(row.after.order.map((o: { id: string }) => o.id)).toEqual(['3', '1', '2']);
      // The page that loaded before the reorder.
      expect(await reorderOffers(pool, OTHER, token, ['2', '1', '3'])).toMatchObject({ ok: false, code: 'conflict', params: { by: 'Mai' } });
      // A list missing an item is refused even with the current token.
      expect(await reorderOffers(pool, OTHER, (await listOffersAdmin(pool)).token, ['2', '1'])).toMatchObject({ ok: false, code: 'conflict' });
      // Restore the order before; an item added since keeps its place after the old ones.
      const added = await createOffer(pool, ACTOR, offerInput({ title: { en: 'Offer 4' } }));
      expect(added).toMatchObject({ ok: true });
      expect(await restoreOfferOrder(pool, ACTOR, { auditId: row.id, side: 'before', token: (await listOffersAdmin(pool)).token })).toMatchObject({ ok: true });
      expect(await titles()).toEqual(['Seafood & Steak Buffet Dinner', 'Vietnamese Cooking Class', 'Afternoon Tea & Dessert Buffet', 'Offer 4']);
      expect((await listHistory(pool, 'offers', null)).map((h) => h.action)).toEqual(['restore', 'reorder']);
    });

    it('reorder: ids tied on sort_order are ordered by number, as the page orders them (10 after 2), so the page’s token holds', async () => {
      await pool.query(`INSERT INTO offers (id, restaurant_id, sort_order, is_published) OVERRIDING SYSTEM VALUE VALUES (10, 'taya-house', 20, false)`);
      await pool.query(`INSERT INTO offer_i18n (offer_id, locale, title) VALUES (10, 'en', 'Tied Offer')`);
      const { items, token } = await listOffersAdmin(pool);
      expect(items.map((i) => i.id)).toEqual(['1', '2', '10', '3']);
      expect(await reorderOffers(pool, ACTOR, token, ['3', '2', '10', '1'])).toEqual({ ok: true, data: null });
      expect((await listOffersAdmin(pool)).items.map((i) => i.id)).toEqual(['3', '2', '10', '1']);
    });

    it('restoring an item’s older version never moves it: the list’s own History restores order', async () => {
      const values = (await getOfferEditor(pool, '2'))!.values;
      expect(await updateOffer(pool, ACTOR, '2', await offerToken('2'), { ...values, title: { en: 'Cooking Class' } })).toMatchObject({ ok: true });
      const [edit] = await audit();
      expect(await reorderOffers(pool, ACTOR, (await listOffersAdmin(pool)).token, ['2', '3', '1'])).toMatchObject({ ok: true });
      expect(await restoreOffer(pool, ACTOR, { id: '2', auditId: edit.id, side: 'before', token: await offerToken('2') })).toEqual({ ok: true, data: null });
      expect((await pool.query('SELECT id::text, sort_order FROM offers ORDER BY id')).rows).toEqual([
        { id: '1', sort_order: 30 },
        { id: '2', sort_order: 10 },
        { id: '3', sort_order: 20 },
      ]);
      expect(await titles()).toEqual(['Vietnamese Cooking Class', 'Afternoon Tea & Dessert Buffet', 'Seafood & Steak Buffet Dinner']);
    });

    it('an item’s token is its content: a reorder of the list since the editor opened is no conflict', async () => {
      const opened = await getOfferEditor(pool, '2');
      expect(await reorderOffers(pool, OTHER, (await listOffersAdmin(pool)).token, ['2', '1', '3'])).toMatchObject({ ok: true });
      expect(await updateOffer(pool, ACTOR, '2', opened!.token, { ...opened!.values, title: { en: 'Cooking Class' } })).toEqual(SAVED);
      expect(await titles()).toEqual(['Cooking Class', 'Seafood & Steak Buffet Dinner', 'Afternoon Tea & Dessert Buffet']);
    });

    it('a version that today’s CHECK refuses is invalid, rolled back, with no audit row (code rule 5), not a server error', async () => {
      const current = (await readItem(pool, OFFER, '2'))!;
      // offers_price_pair (008): a price without its basis.
      const broken = { ...current, row: { ...current.row, price_basis: null } };
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO audit_log (action, entity_type, entity_id, before, after) VALUES ('update', 'offers', '2', $1, $2) RETURNING id::text`,
        [JSON.stringify(broken), JSON.stringify(current)],
      );
      const result = await restoreOffer(pool, ACTOR, { id: '2', auditId: rows[0].id, side: 'before', token: await offerToken('2') });
      expect(result).toEqual({ ok: false, code: 'invalid', fieldErrors: { _: ['Phiên bản này không còn hợp lệ theo luật hôm nay.'] } });
      expect((await readItem(pool, OFFER, '2'))!.row).toMatchObject({ price_amount: 799000, price_basis: 'plus_plus' });
      expect((await audit()).map((a) => a.id)).toEqual([rows[0].id]);
    });

    it('a version that lacks its EN title, or whose restaurant is gone, cannot be restored', async () => {
      const current = (await readItem(pool, OFFER, '1'))!;
      const noTitle = { ...current, i18n: [] };
      const gone = { ...current, row: { ...current.row, restaurant_id: 'no-such-restaurant' } };
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO audit_log (action, entity_type, entity_id, before, after) VALUES ('update', 'offers', '1', $1, $2), ('update', 'offers', '1', $1, $3) RETURNING id::text`,
        [JSON.stringify(current), JSON.stringify(noTitle), JSON.stringify(gone)],
      );
      const token = await offerToken('1');
      expect(await restoreOffer(pool, ACTOR, { id: '1', auditId: rows[0].id, side: 'after', token })).toMatchObject({ ok: false, code: 'invalid', fieldErrors: { title: [expect.any(String)] } });
      expect(await restoreOffer(pool, ACTOR, { id: '1', auditId: rows[1].id, side: 'after', token })).toEqual({ ok: false, code: 'missing_reference' });
      // Another record's audit row cannot be used for this one.
      expect(await restoreOffer(pool, ACTOR, { id: '2', auditId: rows[0].id, side: 'before', token: await offerToken('2') })).toEqual({ ok: false, code: 'not_found' });
      expect((await titles())[0]).toBe('Seafood & Steak Buffet Dinner');
      // A save naming a restaurant that is gone is the form's field error, and writes nothing.
      const values = (await getOfferEditor(pool, '1'))!.values;
      expect(await updateOffer(pool, ACTOR, '1', token, { ...values, restaurantId: 'no-such-restaurant' })).toEqual({
        ok: false,
        code: 'invalid',
        fieldErrors: { restaurantId: ['Nhà hàng này không còn nữa.'] },
      });
      expect((await audit()).map((a) => a.action)).toEqual(['update', 'update']);
    });
  });

  describe('a list without translations (ItemDef.i18n left out)', () => {
    const SOCIAL: ItemDef = {
      entityType: 'social_links',
      table: 'social_links',
      idType: 'bigint',
      columns: ['platform', 'href', 'visible_locales', 'sort_order', 'is_published'],
      tables: ['social_links'],
    };

    it('reads an empty i18n and writes a deleted item back under its id', async () => {
      const before = (await readItem(pool, SOCIAL, '1'))!;
      expect(before).toMatchObject({ v: 1, row: { id: 1 }, i18n: [] });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM social_links WHERE id = 1');
        await writeItem(client, SOCIAL, before, ACTOR.id);
        await client.query('COMMIT');
      } finally {
        client.release();
      }
      const after = (await readItem(pool, SOCIAL, '1'))!;
      const { updated_at: _a, updated_by: _b, ...row } = after.row;
      const { updated_at: _c, updated_by: _d, ...seeded } = before.row;
      expect(row).toEqual(seeded);
    });
  });
});
