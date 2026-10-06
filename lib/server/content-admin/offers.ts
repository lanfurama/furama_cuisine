import 'server-only';
import type { Db } from '@/lib/server/booking/rules';
import { staffName } from './history';
import { makeListEditor, type ListFailure } from './list-editor';
import { orderToken, readItem, readItems, snapshotToken, type ItemDef, type ItemSnapshot } from './snapshot';
import { localeTexts } from './form-locales';

/*
 * The offers list (spec §7.2 content/offers, §6.5 "Offers 0–6"): its ItemDef,
 * the save flow from makeListEditor, and the reads of its screens.
 *
 * Deleting an offer (phase-6 R5): reservations.offer_id is ON DELETE SET NULL,
 * so the bookings keep their date, time, party and "Offer: …" note and lose
 * only the link. That SET NULL is an UPDATE, which bumps each booking's
 * version (reservations_before_write) without saying why (L7-12), so the
 * delete writes one reservation_event 'edited' per unlinked booking, by the
 * staff member who deleted it (R9; spec §7.4 puts booking-side effects
 * there), and keeps the ids in its audit row (before.meta.unlinked_reservations).
 * A restore brings the offer back under its id without relinking them.
 */

export const OFFER: ItemDef = {
  entityType: 'offers',
  table: 'offers',
  idType: 'bigint',
  columns: ['restaurant_id', 'price_amount', 'currency', 'price_basis', 'valid_from', 'valid_until', 'sort_order', 'is_published'],
  i18n: { table: 'offer_i18n', fk: 'offer_id', columns: ['title', 'schedule', 'venue_override'] },
  tables: ['offers', 'offer_i18n'],
};

export type OfferInput = {
  restaurantId: string;
  /** Decimal text ("888000"), or null with priceBasis null (offers_price_pair). */
  priceAmount: string | null;
  currency: string;
  priceBasis: 'plus_plus' | 'net' | null;
  validFrom: string | null;
  validUntil: string | null;
  isPublished: boolean;
  /** One language per key (the form's tabs, phase 8). */
  title: Record<string, string | null>;
  schedule: Record<string, string | null>;
  venueOverride: Record<string, string | null>;
};

const offers = makeListEditor<OfferInput>(OFFER, {
  listKey: 'offers',
  limit: 'offers',
  toRow: (input) => ({
    restaurant_id: input.restaurantId,
    price_amount: input.priceAmount,
    currency: input.currency,
    price_basis: input.priceBasis,
    valid_from: input.validFrom,
    valid_until: input.validUntil,
    is_published: input.isPublished,
  }),
  toI18n: (input) =>
    Object.fromEntries(
      Object.keys(input.title).map((locale) => [
        locale,
        { title: input.title[locale] ?? null, schedule: input.schedule[locale] ?? null, venue_override: input.venueOverride[locale] ?? null },
      ]),
    ),
  async validate(client, { row, i18n }, mode): Promise<ListFailure | null> {
    if (mode === 'restore') {
      // The guest loader drops an offer without an EN title; a version without one cannot come back.
      return i18n.some((r) => r.locale === 'en' && r.title) ? null : { ok: false, code: 'invalid', fieldErrors: { title: ['Phiên bản này thiếu tiêu đề tiếng Anh.'] } };
    }
    // A restaurant gone since the form loaded: the form's field error (a restore gets missing_reference from the FK).
    const { rowCount } = await client.query('SELECT 1 FROM restaurants WHERE id = $1', [row.restaurant_id]);
    return rowCount ? null : { ok: false, code: 'invalid', fieldErrors: { restaurantId: ['Nhà hàng này không còn nữa.'] } };
  },
  async beforeDelete(client, id, actor) {
    // Before the delete: the bookings its SET NULL is about to unlink, each told why in its timeline (R9),
    // by the offer's English title: the admin names content in the default language (spec §7).
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO reservation_events (reservation_id, actor_kind, actor_id, actor_label, type, changes)
       SELECT r.id, 'staff', $2, $3, 'edited',
              jsonb_build_object('offer', jsonb_build_array((SELECT t.title FROM offer_i18n t WHERE t.offer_id = r.offer_id AND t.locale = 'en'), NULL))
         FROM reservations r
        WHERE r.offer_id = $1::bigint
       RETURNING reservation_id::text AS id`,
      [id, actor.id, `${actor.name ?? actor.email} (${actor.email})`],
    );
    return { unlinked_reservations: rows.map((r) => r.id).sort((a, b) => Number(a) - Number(b)) };
  },
});

export const createOffer = offers.create;
export const updateOffer = offers.update;
export const setOfferPublished = offers.setPublished;
export const reorderOffers = offers.reorder;
export const deleteOffer = offers.remove;
export const restoreOffer = offers.restore;
export const restoreOfferOrder = offers.restoreOrder;

// ── reads ─────────────────────────────────────────────────────────────────

export type OfferListItem = {
  id: string;
  title: string | null;
  restaurant: string;
  isPublished: boolean;
  validFrom: string | null;
  validUntil: string | null;
  /** What a guest sees today: shown, hidden by the switch, not yet, ended, or its restaurant hidden. */
  state: 'shown' | 'hidden' | 'upcoming' | 'ended' | 'restaurant_hidden' | 'untitled';
  /** The item's own token, for its show/hide and delete buttons. */
  token: string;
};

export async function listOffersAdmin(db: Db): Promise<{ items: OfferListItem[]; token: string }> {
  const { rows } = await db.query<Omit<OfferListItem, 'token'>>(
    `SELECT o.id::text, t.title, r.name AS restaurant, o.is_published AS "isPublished",
            to_char(o.valid_from, 'YYYY-MM-DD') AS "validFrom", to_char(o.valid_until, 'YYYY-MM-DD') AS "validUntil",
            CASE WHEN t.title IS NULL THEN 'untitled'
                 WHEN NOT o.is_published THEN 'hidden'
                 WHEN NOT r.is_published OR r.archived_at IS NOT NULL THEN 'restaurant_hidden'
                 WHEN o.valid_from > (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date THEN 'upcoming'
                 WHEN o.valid_until < (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date THEN 'ended'
                 ELSE 'shown' END AS state
       FROM offers o
       JOIN restaurants r ON r.id = o.restaurant_id
       -- The list names each offer by its default-language title (the admin's language for content, spec §7).
       LEFT JOIN offer_i18n t ON t.offer_id = o.id AND t.locale = 'en'
      ORDER BY o.sort_order, o.id`,
  );
  const tokens = new Map((await readItems(db, OFFER)).map((s) => [String(s.row.id), snapshotToken(s)]));
  return {
    items: rows.map((r) => ({ ...r, token: tokens.get(r.id) ?? 'deleted' })),
    token: orderToken({ v: 1, order: rows.map((r) => ({ id: r.id, sort_order: 0 })) }),
  };
}

export type OfferEditor = {
  snapshot: ItemSnapshot;
  token: string;
  values: OfferInput;
  updatedAt: Date;
  updatedBy: string | null;
};


export function offerValues(s: ItemSnapshot): OfferInput {
  const r = s.row;
  return {
    restaurantId: String(r.restaurant_id),
    priceAmount: r.price_amount === null ? null : String(Number(r.price_amount)),
    currency: String(r.currency),
    priceBasis: (r.price_basis as OfferInput['priceBasis']) ?? null,
    validFrom: (r.valid_from as string | null) ?? null,
    validUntil: (r.valid_until as string | null) ?? null,
    isPublished: Boolean(r.is_published),
    title: localeTexts(s.i18n, 'title'),
    schedule: localeTexts(s.i18n, 'schedule'),
    venueOverride: localeTexts(s.i18n, 'venue_override'),
  };
}

export async function getOfferEditor(db: Db, id: string): Promise<OfferEditor | null> {
  if (!/^\d{1,18}$/.test(id)) return null;
  const snapshot = await readItem(db, OFFER, id);
  if (!snapshot) return null;
  return {
    snapshot,
    token: snapshotToken(snapshot),
    values: offerValues(snapshot),
    updatedAt: new Date(String(snapshot.row.updated_at)),
    updatedBy: await staffName(db, snapshot.row.updated_by),
  };
}
