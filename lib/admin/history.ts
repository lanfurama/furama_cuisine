/*
 * How the History tab (spec §7.5) reads audit_log rows: which fields a save
 * changed, and which versions a row offers to restore. Pure, so it is shared
 * by the server page and its tests; snapshots are the ItemSnapshot shape of
 * lib/server/content-admin/snapshot.ts (row, i18n[], plus an aggregate's own
 * lists such as a restaurant's cuisines and highlights).
 */

type Row = Record<string, unknown>;
export type Snap = { row?: Row; i18n?: Row[]; order?: unknown; [list: string]: unknown } | null;

/** Bookkeeping that every save changes; never reported as a change. */
const NOISE = new Set(['updated_at', 'updated_by', 'reviewed_at', 'reviewed_by', 'created_at', 'status', 'origin', 'ai_model', 'source_hash']);

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The labels of the fields that differ between two snapshots, in the label
 * map's order. A field with no label is shown by its column name; a language
 * other than EN is suffixed with its code; `list:<key>` names an aggregate's
 * child list.
 */
export function changedFields(before: Snap, after: Snap, labels: Record<string, string>): string[] {
  if (!before || !after) return [];
  const changed = new Set<string>();
  const rowKeys = new Set([...Object.keys(before.row ?? {}), ...Object.keys(after.row ?? {})]);
  for (const k of rowKeys) if (!NOISE.has(k) && !same(before.row?.[k], after.row?.[k])) changed.add(k);
  const byLocale = (s: Snap) => new Map((s?.i18n ?? []).map((r) => [String(r.locale), r]));
  const [b, a] = [byLocale(before), byLocale(after)];
  for (const locale of new Set([...b.keys(), ...a.keys()])) {
    const keys = new Set([...Object.keys(b.get(locale) ?? {}), ...Object.keys(a.get(locale) ?? {})]);
    for (const k of keys) {
      // The parent's id (offer_id, restaurant_id …) is not a field; menu_pdf_media_id is one.
      if (NOISE.has(k) || k === 'locale' || (k.endsWith('_id') && k !== 'menu_pdf_media_id')) continue;
      if (!same(b.get(locale)?.[k], a.get(locale)?.[k])) changed.add(locale === 'en' ? k : `${k} (${locale})`);
    }
  }
  for (const list of Object.keys(labels).filter((k) => k.startsWith('list:'))) {
    const key = list.slice(5);
    if (!same(before[key], after[key])) changed.add(list);
  }
  const order = Object.keys(labels);
  return [...changed]
    .sort((x, y) => (order.indexOf(x.split(' ')[0]) + 1 || 999) - (order.indexOf(y.split(' ')[0]) + 1 || 999))
    .map((k) => {
      const [col, suffix] = k.split(' ');
      return `${labels[col] ?? col}${suffix ? ` ${suffix}` : ''}`;
    });
}

export type HistoryRow = { id: string; action: string; before: Snap; after: Snap };

/** A version a history row offers back: which side of the row, and the button's words. */
export type RestoreChoice = { side: 'before' | 'after'; label: string };

/**
 * What each row (newest first) offers to restore, given the token of the
 * record as it is now ('deleted' when it is gone) and the token function.
 * Never the current version:
 * - a delete: the item as it was (before);
 * - any other row: the version it produced (after), and the version before
 *   it, so the newest row undoes the last change ("Khôi phục bản trước lần
 *   này") and the oldest reaches the seed, which has no row of its own;
 * - nothing for a file's move to Vercel Blob (after.meta.moved_by,
 *   scripts/move-assets-to-blob.mjs): a restore writes alt text and flags,
 *   never a file's url or storage, so neither side of the move can come back.
 */
export function restoreChoices(rows: readonly HistoryRow[], currentToken: string, token: (s: Snap) => string): RestoreChoice[][] {
  return rows.map((r) => {
    const choices: RestoreChoice[] = [];
    if ((r.after as { meta?: { moved_by?: unknown } } | null)?.meta?.moved_by) return choices;
    if (r.action === 'delete') {
      if (r.before) choices.push({ side: 'before', label: 'Khôi phục mục đã xóa' });
      return choices;
    }
    if (r.after && token(r.after) !== currentToken) choices.push({ side: 'after', label: 'Khôi phục phiên bản này' });
    if (r.before && token(r.before) !== currentToken) choices.push({ side: 'before', label: 'Khôi phục bản trước lần này' });
    return choices;
  });
}
