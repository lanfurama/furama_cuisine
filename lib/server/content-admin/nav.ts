import 'server-only';
import { LENGTHS, NAV_TARGETS } from '@/lib/admin/content-rules';
import type { SectionKey } from '@/lib/content/types';
import type { Db } from '@/lib/server/booking/rules';
import { makeListEditor, type ListFailure } from './list-editor';
import { orderToken, readItems, snapshotToken, type ItemDef, type ItemSnapshot } from './snapshot';

/*
 * The navigation menu (spec §7.2 content/navigation, §6.5 "Menu điều hướng
 * tối đa 6 mục. Nhãn dài hơn 14 ký tự thì cảnh báo; dài hơn 18 thì không cho
 * lưu. Mục tự ẩn khi section đích bị ẩn"; phase-6 L7-14): each item names a
 * home section it scrolls to and a label, in the header and the menu
 * overlay. Every write goes through makeListEditor: at most 6 shown (R4),
 * the EN label (the loader drops an item without one) of at most 18
 * characters (CHECK nav_item_i18n.label; the form warns past 14), one item
 * per section (nav_items_target_section_key) and never the film, finder,
 * hero or booking bar (CHECK; NAV_TARGETS). An item whose section is
 * switched off is left out by loadNav; the screen says so.
 */

export const NAV_ITEM: ItemDef = {
  entityType: 'nav_items',
  table: 'nav_items',
  idType: 'bigint',
  columns: ['target_section', 'sort_order', 'is_published'],
  i18n: { table: 'nav_item_i18n', fk: 'nav_item_id', columns: ['label'] },
  tables: ['nav_items', 'nav_item_i18n'],
};

export type NavInput = {
  /** The item's id when it exists (the action posts the record's), so the one-per-section rule can leave it out. */
  id: string | null;
  targetSection: SectionKey;
  isPublished: boolean;
  /** One language per key: the form sends EN only until phase 8 adds its tabs. */
  label: Record<string, string | null>;
};

export const NAV_NEEDS_LABEL = `Nhập nhãn tiếng Anh, tối đa ${LENGTHS.navLabel.max} ký tự.`;
export const NAV_TARGET_TAKEN = 'Đã có một mục trỏ tới section này. Sửa mục đó, hoặc chọn section khác.';
export const NAV_TARGET_INVALID = 'Menu chỉ trỏ được tới các section có trong thanh menu.';

const nav = makeListEditor<NavInput>(NAV_ITEM, {
  listKey: 'nav_items',
  limit: 'navItems',
  toRow: (input) => ({ id: input.id, target_section: input.targetSection, is_published: input.isPublished }),
  toI18n: (input) => Object.fromEntries(Object.keys(input.label).map((locale) => [locale, { label: input.label[locale] ?? null }])),
  // Today's rules, on a save and on a restore alike (code rule 5).
  async validate(client, { row, i18n }): Promise<ListFailure | null> {
    const label = i18n.find((r) => r.locale === 'en')?.label;
    if (typeof label !== 'string' || !label.trim() || [...label].length > LENGTHS.navLabel.max) {
      return { ok: false, code: 'invalid', fieldErrors: { label: [NAV_NEEDS_LABEL] } };
    }
    if (!(NAV_TARGETS as readonly unknown[]).includes(row.target_section)) {
      return { ok: false, code: 'invalid', fieldErrors: { targetSection: [NAV_TARGET_INVALID] } };
    }
    const id = row.id === null || row.id === undefined ? null : String(row.id);
    const { rowCount } = await client.query(`SELECT 1 FROM nav_items WHERE target_section = $1 AND ($2::bigint IS NULL OR id <> $2::bigint)`, [
      row.target_section,
      id,
    ]);
    return rowCount ? { ok: false, code: 'invalid', fieldErrors: { targetSection: [NAV_TARGET_TAKEN] } } : null;
  },
});

export const createNavItem = nav.create;
export const updateNavItem = nav.update;
export const setNavItemPublished = nav.setPublished;
export const reorderNavItems = nav.reorder;
export const deleteNavItem = nav.remove;
export const restoreNavItem = nav.restore;
export const restoreNavItemOrder = nav.restoreOrder;

/** The form's values for one item, from its snapshot. */
export function navValues(s: ItemSnapshot): NavInput {
  const en = s.i18n.find((r) => r.locale === 'en');
  return {
    id: String(s.row.id),
    targetSection: s.row.target_section as SectionKey,
    isPublished: Boolean(s.row.is_published),
    label: { en: (en?.label as string | null | undefined) ?? null },
  };
}

export type NavListItem = {
  id: string;
  /** How the screen names it: the EN label, else its section. */
  name: string;
  isPublished: boolean;
  /** Its section is switched on (sections.is_visible): off, the item stays out of the menu whatever its switch says. */
  sectionVisible: boolean;
  token: string;
  values: NavInput;
};

/** Every item in its menu order, with its token and form values, and the list's token (the ids in order). */
export async function listNavAdmin(db: Db): Promise<{ items: NavListItem[]; token: string }> {
  const [snapshots, sections] = await Promise.all([readItems(db, NAV_ITEM), db.query<{ key: string; is_visible: boolean }>('SELECT key, is_visible FROM sections')]);
  const visible = new Map(sections.rows.map((s) => [s.key, s.is_visible]));
  const items = snapshots.map((s) => {
    const values = navValues(s);
    return {
      id: values.id!,
      name: values.label.en || values.targetSection,
      isPublished: values.isPublished,
      sectionVisible: visible.get(values.targetSection) ?? true,
      token: snapshotToken(s),
      values,
    };
  });
  return { items, token: orderToken({ v: 1, order: items.map((i) => ({ id: i.id, sort_order: 0 })) }) };
}
