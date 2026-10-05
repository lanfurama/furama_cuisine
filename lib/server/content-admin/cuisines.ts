import 'server-only';
import type { Db } from '@/lib/server/booking/rules';
import { makeListEditor, WHOLE_ITEM, type ListFailure } from './list-editor';
import { orderToken, readItems, snapshotToken, type ItemDef, type ItemSnapshot } from './snapshot';

/*
 * The cuisines list (spec §7.2 content/cuisines, §6.5 "Cuisines: nên tối đa
 * 10"): the home page's cuisine rail, and the cuisine filter of the finder,
 * the search overlay and the restaurant cards. Every write goes through
 * makeListEditor: the label in EN (the loaders drop a cuisine without one),
 * the picture live (code rule 2; cuisines.image_id is NOT NULL). Ten is
 * advice, not a limit (R4: the screen warns past it). The id is the slug,
 * typed once: it is the filter's key, and restaurants point at it.
 *
 * Hiding a cuisine takes its chip off the rail and the filters, and its label
 * off the restaurant cards (loadRestaurants reads published cuisines only).
 * A cuisine a restaurant still lists cannot be deleted (restaurant_cuisines:
 * ON DELETE RESTRICT); the refusal names those restaurants.
 */

export const CUISINE: ItemDef = {
  entityType: 'cuisines',
  table: 'cuisines',
  idType: 'text',
  columns: ['image_id', 'sort_order', 'is_published'],
  i18n: { table: 'cuisine_i18n', fk: 'cuisine_id', columns: ['label'] },
  tables: ['cuisines', 'cuisine_i18n'],
  media: [{ column: 'image_id', kind: 'image', field: 'imageId' }],
};

export type CuisineInput = {
  /** The slug: typed when the cuisine is added, then posted back unchanged. */
  id: string;
  imageId: string;
  isPublished: boolean;
  /** One language per key: the form sends EN only until phase 8 adds its tabs. */
  label: Record<string, string | null>;
};

export const CUISINE_NEEDS_LABEL = 'Nhập tên ẩm thực tiếng Anh: thiếu tên, ẩm thực không hiện ở đâu cả.';

const cuisines = makeListEditor<CuisineInput>(CUISINE, {
  listKey: 'cuisines',
  toRow: (input) => ({ id: input.id, image_id: input.imageId, is_published: input.isPublished }),
  toI18n: (input) => Object.fromEntries(Object.keys(input.label).map((locale) => [locale, { label: input.label[locale] ?? null }])),
  // Today's rule, on a save and on a restore alike (code rule 5).
  async validate(_client, { i18n }): Promise<ListFailure | null> {
    return i18n.some((r) => r.locale === 'en' && typeof r.label === 'string' && r.label.trim())
      ? null
      : { ok: false, code: 'invalid', fieldErrors: { label: [CUISINE_NEEDS_LABEL] } };
  },
  async refuseDelete(client, id): Promise<ListFailure | null> {
    const { rows } = await client.query<{ name: string }>(
      `SELECT r.name FROM restaurant_cuisines rc JOIN restaurants r ON r.id = rc.restaurant_id WHERE rc.cuisine_id = $1 ORDER BY r.sort_order, r.id`,
      [id],
    );
    if (rows.length === 0) return null;
    const names = rows.map((r) => r.name).join(', ');
    return {
      ok: false,
      code: 'invalid',
      fieldErrors: { [WHOLE_ITEM]: [`Ẩm thực này đang gắn với ${rows.length} nhà hàng (${names}). Bỏ nó ở các nhà hàng đó trước, hoặc chỉ ẩn nó.`] },
    };
  },
});

export const createCuisine = cuisines.create;
export const updateCuisine = cuisines.update;
export const setCuisinePublished = cuisines.setPublished;
export const reorderCuisines = cuisines.reorder;
export const deleteCuisine = cuisines.remove;
export const restoreCuisine = cuisines.restore;
export const restoreCuisineOrder = cuisines.restoreOrder;

// ── reads ─────────────────────────────────────────────────────────────────

/** The form's values for one cuisine, from its snapshot. */
export function cuisineValues(s: ItemSnapshot): CuisineInput {
  const en = s.i18n.find((r) => r.locale === 'en');
  return {
    id: String(s.row.id),
    imageId: String(s.row.image_id),
    isPublished: Boolean(s.row.is_published),
    label: { en: (en?.label as string | null | undefined) ?? null },
  };
}

export type CuisineListItem = {
  id: string;
  /** How the screen names it: the EN label, else the id. */
  name: string;
  isPublished: boolean;
  token: string;
  values: CuisineInput;
  /** Restaurants that list it (any state): a delete is refused while there are any. */
  restaurants: number;
  /** Of those, the ones guests see (the catalogue's rule: shown, not archived, at a shown destination): the cards a hide takes it off. */
  shownRestaurants: number;
};

/** Every cuisine in its guest order, with its token and form values, and the list's token (the ids in order). */
export async function listCuisinesAdmin(db: Db): Promise<{ items: CuisineListItem[]; token: string }> {
  const [snapshots, counts] = await Promise.all([
    readItems(db, CUISINE),
    db.query<{ id: string; n: number; shown: number }>(
      `SELECT rc.cuisine_id AS id, count(*)::int AS n,
              (count(*) FILTER (WHERE r.is_published AND r.archived_at IS NULL AND d.is_published))::int AS shown
         FROM restaurant_cuisines rc
         JOIN restaurants r ON r.id = rc.restaurant_id
         JOIN destinations d ON d.id = r.destination_id
        GROUP BY rc.cuisine_id`,
    ),
  ]);
  const used = new Map(counts.rows.map((r) => [r.id, r]));
  const items = snapshots.map((s) => {
    const values = cuisineValues(s);
    return {
      id: values.id,
      name: values.label.en || values.id,
      isPublished: values.isPublished,
      token: snapshotToken(s),
      values,
      restaurants: used.get(values.id)?.n ?? 0,
      shownRestaurants: used.get(values.id)?.shown ?? 0,
    };
  });
  return { items, token: orderToken({ v: 1, order: items.map((i) => ({ id: i.id, sort_order: 0 })) }) };
}
