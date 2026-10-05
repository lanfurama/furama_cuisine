import 'server-only';
import type { Pool } from 'pg';
import type { Db } from '@/lib/server/booking/rules';
import { makeListEditor, WHOLE_ITEM, type ListFailure } from './list-editor';
import { orderToken, readItems, snapshotToken, type ItemDef, type ItemSnapshot } from './snapshot';

/*
 * The destinations list (spec §7.2 content/destinations, §6.5 "Destinations
 * 2–5, tối đa 1 thẻ teaser"): the home page's destination cards, and the
 * places the finder, the footer and "More at …" name. Every write goes
 * through makeListEditor: at most 5 shown (R4: fewer than 2 only warns), at
 * most one teaser shown, a venue has an EN name (phase-6 L7-7: no "More at "
 * or footer line without one), the card's picture live (code rule 2). The id
 * is the slug, typed once (restaurants, closures and recipients point at it).
 *
 * Hiding a destination hides its restaurants everywhere a guest reaches them
 * (phase-6 ledger D1, L7-2): the catalogue, their pages, their offers and
 * online booking (lib/server/content/restaurants.queries.ts HAS_PAGE,
 * home.queries.ts loadOffers, lib/server/booking/rules.ts bookableSql). Staff
 * paths still see them. A destination that restaurants, closures or
 * recipients point at cannot be deleted: closures and recipients would go
 * with it (ON DELETE CASCADE) and no restore brings them back.
 */

export const DESTINATION: ItemDef = {
  entityType: 'destinations',
  table: 'destinations',
  idType: 'text',
  columns: ['kind', 'card_image_id', 'phone_e164', 'phone_display', 'email', 'map_url', 'show_in_footer', 'sort_order', 'is_published'],
  i18n: { table: 'destination_i18n', fk: 'destination_id', columns: ['name', 'card_title_1', 'card_title_2', 'card_blurb_1', 'card_blurb_2', 'address'] },
  tables: ['destinations', 'destination_i18n'],
  media: [{ column: 'card_image_id', kind: 'image', field: 'cardImageId' }],
};

/** One language per key: the form sends EN only until phase 8 adds its tabs. */
type Text = Record<string, string | null>;

export type DestinationInput = {
  /** The slug: typed when the destination is added, then posted back unchanged. */
  id: string;
  kind: 'venue' | 'teaser';
  isPublished: boolean;
  showInFooter: boolean;
  cardImageId: string | null;
  phoneDisplay: string | null;
  phoneE164: string | null;
  email: string | null;
  mapUrl: string | null;
  name: Text;
  cardTitle1: Text;
  cardTitle2: Text;
  cardBlurb1: Text;
  cardBlurb2: Text;
  address: Text;
};

export const VENUE_NEEDS_NAME = 'Một địa điểm cần tên tiếng Anh: bộ lọc, chân trang và “More at …” in tên này.';
export const ONE_TEASER = 'Chỉ một thẻ teaser được hiện (giới hạn bố cục). Hãy ẩn thẻ teaser kia trước.';

const destinations = makeListEditor<DestinationInput>(DESTINATION, {
  listKey: 'destinations',
  limit: 'destinations',
  toRow: (input) => ({
    id: input.id,
    kind: input.kind,
    card_image_id: input.cardImageId,
    phone_e164: input.phoneE164,
    phone_display: input.phoneDisplay,
    email: input.email,
    map_url: input.mapUrl,
    show_in_footer: input.showInFooter,
    is_published: input.isPublished,
  }),
  toI18n: (input) =>
    Object.fromEntries(
      Object.keys(input.name).map((locale) => [
        locale,
        {
          name: input.name[locale] ?? null,
          card_title_1: input.cardTitle1[locale] ?? null,
          card_title_2: input.cardTitle2[locale] ?? null,
          card_blurb_1: input.cardBlurb1[locale] ?? null,
          card_blurb_2: input.cardBlurb2[locale] ?? null,
          address: input.address[locale] ?? null,
        },
      ]),
    ),
  // Today's rules, on a save and on a restore alike (code rule 5). `row.id` is the item's (the form posts it back; a snapshot has it).
  async validate(client, { row, i18n }): Promise<ListFailure | null> {
    if (row.kind === 'venue' && !i18n.some((r) => r.locale === 'en' && typeof r.name === 'string' && r.name.trim())) {
      return { ok: false, code: 'invalid', fieldErrors: { name: [VENUE_NEEDS_NAME] } };
    }
    if (row.kind === 'teaser' && row.is_published === true) {
      const { rowCount } = await client.query(`SELECT 1 FROM destinations WHERE kind = 'teaser' AND is_published AND id <> $1`, [String(row.id)]);
      if (rowCount) return { ok: false, code: 'invalid', fieldErrors: { isPublished: [ONE_TEASER] } };
    }
    return null;
  },
  async refuseDelete(client, id): Promise<ListFailure | null> {
    const { rows } = await client.query<{ restaurants: number; closures: number; recipients: number }>(
      `SELECT (SELECT count(*) FROM restaurants WHERE destination_id = $1)::int AS restaurants,
              (SELECT count(*) FROM closures WHERE destination_id = $1)::int AS closures,
              (SELECT count(*) FROM notification_recipients WHERE destination_id = $1)::int AS recipients`,
      [id],
    );
    const { restaurants, closures, recipients } = rows[0];
    const why: string[] = [];
    if (restaurants) why.push(`Điểm đến này còn ${restaurants} nhà hàng (kể cả nhà hàng đang ẩn hay lưu trữ). Chuyển chúng sang điểm đến khác trước, hoặc chỉ ẩn điểm đến.`);
    if (closures || recipients) {
      why.push('Điểm đến này còn có ngày đóng cửa hoặc người nhận thông báo riêng; xóa nó sẽ xóa luôn chúng. Sửa chúng trước, hoặc chỉ ẩn điểm đến.');
    }
    return why.length ? { ok: false, code: 'invalid', fieldErrors: { [WHOLE_ITEM]: why } } : null;
  },
});

export const createDestination = destinations.create;
export const updateDestination = destinations.update;
export const setDestinationPublished = destinations.setPublished;
export const reorderDestinations = destinations.reorder;
export const deleteDestination = destinations.remove;
export const restoreDestination = destinations.restore;
export const restoreDestinationOrder = destinations.restoreOrder;

// ── reads ─────────────────────────────────────────────────────────────────

const en = (s: ItemSnapshot, col: string) => (s.i18n.find((r) => r.locale === 'en')?.[col] as string | null | undefined) ?? null;

/** The form's values for one destination, from its snapshot. */
export function destinationValues(s: ItemSnapshot): DestinationInput {
  const r = s.row;
  return {
    id: String(r.id),
    kind: r.kind === 'teaser' ? 'teaser' : 'venue',
    isPublished: Boolean(r.is_published),
    showInFooter: Boolean(r.show_in_footer),
    cardImageId: (r.card_image_id as string | null) ?? null,
    phoneDisplay: (r.phone_display as string | null) ?? null,
    phoneE164: (r.phone_e164 as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    mapUrl: (r.map_url as string | null) ?? null,
    name: { en: en(s, 'name') },
    cardTitle1: { en: en(s, 'card_title_1') },
    cardTitle2: { en: en(s, 'card_title_2') },
    cardBlurb1: { en: en(s, 'card_blurb_1') },
    cardBlurb2: { en: en(s, 'card_blurb_2') },
    address: { en: en(s, 'address') },
  };
}

export type DestinationListItem = {
  id: string;
  /** How the screen names it: the EN name, else the card's title lines, else the id. */
  name: string;
  kind: 'venue' | 'teaser';
  isPublished: boolean;
  token: string;
  values: DestinationInput;
  /** Its restaurants guests can see while it is shown (published, not archived): what hiding it takes off the site. */
  shownRestaurants: number;
};

/** Every destination in its guest order, with its token and form values, and the list's token (the ids in order). */
export async function listDestinationsAdmin(db: Db): Promise<{ items: DestinationListItem[]; token: string }> {
  const [snapshots, counts] = await Promise.all([
    readItems(db, DESTINATION),
    db.query<{ id: string; n: number }>(
      `SELECT destination_id AS id, count(*)::int AS n FROM restaurants WHERE is_published AND archived_at IS NULL GROUP BY destination_id`,
    ),
  ]);
  const shown = new Map(counts.rows.map((r) => [r.id, r.n]));
  const items = snapshots.map((s) => {
    const values = destinationValues(s);
    const title = [values.cardTitle1.en, values.cardTitle2.en].filter(Boolean).join(' ');
    return {
      id: values.id,
      name: values.name.en || title || values.id,
      kind: values.kind,
      isPublished: values.isPublished,
      token: snapshotToken(s),
      values,
      shownRestaurants: shown.get(values.id) ?? 0,
    };
  });
  return { items, token: orderToken({ v: 1, order: items.map((i) => ({ id: i.id, sort_order: 0 })) }) };
}

/** The restaurants at one destination, any state: a write to the destination changes whether guests can book them. */
export async function restaurantsAt(pool: Pool, destinationId: string): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>('SELECT id FROM restaurants WHERE destination_id = $1 ORDER BY id', [destinationId]);
  return rows.map((r) => r.id);
}

/**
 * The destinations staff pick from (a closure's or a recipient's scope, a
 * restaurant's place) and the names the admin prints for them: every venue,
 * shown or hidden, by its name in the default language, in display order.
 * The teaser card ("Future Locations") is not a place, so it is left out.
 * Moved here from lib/server/booking/queries.ts (phase-6 ledger L7-10): the
 * content layer owns destinations.
 */
export async function listDestinationOptions(db: Db): Promise<{ id: string; name: string }[]> {
  const { rows } = await db.query<{ id: string; name: string }>(
    `SELECT d.id, coalesce(dt.name, d.id) AS name
       FROM destinations d
       LEFT JOIN destination_i18n dt ON dt.destination_id = d.id AND dt.locale = (SELECT code FROM locales WHERE is_default)
      WHERE d.kind = 'venue'
      ORDER BY d.sort_order, d.id`,
  );
  return rows;
}
