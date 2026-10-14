import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { followRename, LENGTHS } from '@/lib/admin/content-rules';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';
import { insertAudit, withTransaction, type AuditActor } from '@/lib/server/audit';
import { lockList, readItem, upsertTranslation, type ItemDef } from '@/lib/server/history/snapshot';
import { MEDIA } from '@/lib/server/media/library';
import { CUISINE } from './cuisines';
import { DESTINATION } from './destinations';
import { EXPERIENCE } from './experiences';
import { HERO_SLIDE } from './hero';
import { OFFER } from './offers';
import { HIGHLIGHT, readRestaurant, RESTAURANT } from './restaurants';
import { readSection } from './sections';
import { STORY } from './stories';

/*
 * A content pack: a reviewed set of edits to the seeded content (new pictures
 * from public/assets, corrected words), applied in one transaction as if an
 * editor had saved each item: one audit_log row per item, holding the item
 * before and after as its History reads it, so "Khôi phục bản trước lần này"
 * brings the old version back.
 *
 * A pack only replaces what is still as the seed left it. Every change names
 * the value it expects (`from`): a picture still pointing at the seeded file
 * (static, or the same file moved to Blob by scripts/move-assets-to-blob.mjs),
 * a column still holding the seeded value, an English text still the seed's
 * (origin 'seed'). Anything staff changed since is skipped and reported, never
 * overwritten. Run by scripts/apply-content-pack.mjs.
 *
 * It locks as the editors do (the list's advisory lock, then the item's row
 * FOR UPDATE) before it reads the version it replaces, and changes only the
 * columns those screens save and History restores; every identifier in its
 * SQL is one of those constants, never the pack's own text.
 */

/** The lists a pack may touch; a highlight is audited as part of its restaurant, as its screen saves it. */
export const PACK_ENTITIES = [
  'restaurants',
  'restaurant_highlights',
  'destinations',
  'cuisines',
  'experiences',
  'stories',
  'offers',
  'hero_slides',
  'sections',
] as const;
export type PackEntity = (typeof PACK_ENTITIES)[number];

export type PackChange =
  /**
   * Point a picture column at another file of the library, by pathname, or (null) take an optional
   * picture away (a destination card shows its lattice instead). `from` is the seeded file's name.
   */
  | { kind: 'image'; entity: PackEntity; id: string; column: string; from: string; to: string | null }
  /** A column of the item's own row (a link, a date, a price). */
  | { kind: 'row'; entity: PackEntity; id: string; column: string; from: string | null; to: string | null }
  /** A column of the item's English row. */
  | { kind: 'text'; entity: PackEntity; id: string; column: string; from: string | null; to: string };

export type ContentPack = { id: string; changes: PackChange[] };

export type PackOutcome = { change: PackChange; applied: boolean; reason?: string };

/** The item History lists a change under, and how it reads it. */
type Audited = { entityType: string; entityId: string; read: () => Promise<object | null> };

type Target = {
  table: string;
  /** The column that names a row, and its type (a pack's ids are text). */
  key: string;
  idType: ItemDef['idType'];
  i18n?: { table: string; fk: string };
  /** The columns a pack may change, by kind of change. */
  columns: Record<PackChange['kind'], readonly string[]>;
  /** The advisory lock its editor takes (makeListEditor's listKey, lockList), if it takes one. */
  listKey?: string;
  /** Locks the row its editor locks before a save, and names the item History lists the change under; null when it is gone. */
  lock: (db: PoolClient, id: string) => Promise<Audited | null>;
};

/**
 * Not for a pack: switches, the order, where an item belongs, and a
 * restaurant's slug. Their screens do what a pack does not (spec §6.5's
 * limits, the first slide's crop, a page's portrait and story, a teaser that
 * is no place, a venue; the slug is the page's address), and a restore never
 * writes sort_order back. A restaurant's name may change: its card's alt
 * follows, as on its screen (R19, followCardAlt).
 */
const NOT_BY_PACK = ['sort_order', 'is_published', 'archived_at', 'is_visible', 'has_detail_page', 'kind', 'destination_id', 'restaurant_id', 'slug'];

/** What a save of the item writes and History restores: its row's columns and its translatable texts (a menu file is not text). */
function columnsOf(def: ItemDef, images: readonly string[]): Target['columns'] {
  return {
    image: images,
    row: def.columns.filter((c) => !NOT_BY_PACK.includes(c) && !images.includes(c)),
    text: (def.i18n?.columns ?? []).filter((c) => !c.endsWith('_id')),
  };
}

/** The item's row FOR UPDATE, as its editor takes it before reading the version it replaces. */
async function lockRow(db: PoolClient, table: string, key: string, idType: string, id: string): Promise<boolean> {
  return (await db.query(`SELECT 1 FROM ${table} WHERE ${key} = $1::${idType} FOR UPDATE`, [id])).rowCount === 1;
}

const listed = (def: ItemDef): Target => ({
  table: def.table,
  key: 'id',
  idType: def.idType,
  i18n: def.i18n ? { table: def.i18n.table, fk: def.i18n.fk } : undefined,
  columns: columnsOf(
    def,
    (def.media ?? []).filter((m) => m.kind === 'image').map((m) => m.column),
  ),
  // Every list here passes its entityType as makeListEditor's listKey.
  listKey: def.entityType,
  lock: async (db, id) => ((await lockRow(db, def.table, 'id', def.idType, id)) ? { entityType: def.entityType, entityId: id, read: () => readItem(db, def, id) } : null),
});

const TARGETS: Record<PackEntity, Target> = {
  // The restaurant screen locks the row (lockRestaurant); 'restaurants' is the lock of its list's create and order.
  restaurants: {
    table: 'restaurants',
    key: 'id',
    idType: RESTAURANT.idType,
    i18n: { table: 'restaurant_i18n', fk: 'restaurant_id' },
    columns: columnsOf(RESTAURANT, ['card_image_id', 'detail_image_id', 'og_image_id']),
    listKey: 'restaurants',
    lock: async (db, id) => ((await lockRow(db, 'restaurants', 'id', RESTAURANT.idType, id)) ? { entityType: RESTAURANT.entityType, entityId: id, read: () => readRestaurant(db, id) } : null),
  },
  restaurant_highlights: {
    table: 'restaurant_highlights',
    key: 'id',
    idType: HIGHLIGHT.idType,
    i18n: { table: 'restaurant_highlight_i18n', fk: 'highlight_id' },
    columns: columnsOf(HIGHLIGHT, ['image_id']),
    listKey: 'restaurants',
    lock: async (db, id) => {
      const { rows } = await db.query<{ owner: string }>('SELECT restaurant_id AS owner FROM restaurant_highlights WHERE id = $1::bigint', [id]);
      const owner = rows[0]?.owner;
      // Its restaurant's row first, as the restaurant screen locks it before it writes the highlights; then the highlight, still that restaurant's.
      if (!owner || !(await lockRow(db, 'restaurants', 'id', RESTAURANT.idType, owner))) return null;
      const { rowCount } = await db.query('SELECT 1 FROM restaurant_highlights WHERE id = $1::bigint AND restaurant_id = $2 FOR UPDATE', [id, owner]);
      return rowCount === 1 ? { entityType: RESTAURANT.entityType, entityId: owner, read: () => readRestaurant(db, owner) } : null;
    },
  },
  destinations: listed(DESTINATION),
  cuisines: listed(CUISINE),
  experiences: listed(EXPERIENCE),
  stories: listed(STORY),
  offers: listed(OFFER),
  hero_slides: listed(HERO_SLIDE),
  // One row per section, keyed by its name, locked by its screen (lockSection); no translations.
  sections: {
    table: 'sections',
    key: 'key',
    idType: 'text',
    columns: { image: ['image_id'], row: ['link_url'], text: [] },
    lock: async (db, key) => ((await lockRow(db, 'sections', 'key', 'text', key)) ? { entityType: 'sections', entityId: key, read: () => readSection(db, key) } : null),
  },
};

const KINDS: readonly string[] = ['image', 'row', 'text'];

/** The pictures an item may go without (their screens' optionalMedia); every other one a pack can only replace. */
const OPTIONAL_PICTURES: readonly string[] = ['destinations.card_image_id', 'restaurants.og_image_id'];

/**
 * "/assets/r-danaksara.jpg", or its copy in Blob ("production/assets/r-danaksara.jpg",
 * movedAssetPathname): the same seeded file. An upload lives under <folder>/media/<uuid>/, so one
 * with the same file name is not it.
 */
function isSeededFile(pathname: string, seeded: string): boolean {
  if (pathname === seeded) return true;
  return seeded.startsWith('/assets/') && pathname.endsWith(seeded) && /^[a-z]+$/.test(pathname.slice(0, -seeded.length));
}

/** The value a pack expects: null is empty. */
const same = (now: string | null, expected: unknown) => (expected === null || expected === undefined ? now === null : now === String(expected));

/** Checks a pack's shape before anything is read: known lists, ids of their type, only columns a pack may change. */
export function packErrors(pack: ContentPack): string[] {
  if (!pack || typeof pack.id !== 'string' || !pack.id || !Array.isArray(pack.changes)) return ['a pack needs an id and a list of changes'];
  const errors: string[] = [];
  for (const [i, c] of pack.changes.entries()) {
    const at = `change ${i + 1} (${c?.entity} ${c?.id} ${c?.column})`;
    if (!(PACK_ENTITIES as readonly string[]).includes(c?.entity)) {
      errors.push(`${at}: unknown list`);
      continue;
    }
    if (!KINDS.includes(c.kind)) {
      errors.push(`${at}: unknown kind`);
      continue;
    }
    const t = TARGETS[c.entity];
    // A pack's ids are text; a bigint list's are digits (a cast that fails would end the whole run).
    if (typeof c.id !== 'string' || !(t.idType === 'bigint' ? /^\d{1,18}$/ : /\S/).test(c.id)) errors.push(`${at}: the id must be text${t.idType === 'bigint' ? ' of digits' : ''}`);
    if (c.kind === 'image' && !String(c.column).endsWith('_id')) errors.push(`${at}: a picture goes into an *_id column`);
    else if (c.kind === 'text' && !t.i18n) errors.push(`${at}: this list has no translations`);
    else if (!t.columns[c.kind].includes(c.column)) errors.push(`${at}: not a column a pack may change (${c.kind}: ${t.columns[c.kind].join(', ') || 'none'})`);
    if (c.kind === 'image' && (typeof c.from !== 'string' || (typeof c.to !== 'string' && c.to !== null))) errors.push(`${at}: a picture's from is a pathname, its to a pathname or null`);
    if (c.kind === 'image' && c.to === null && !OPTIONAL_PICTURES.includes(`${c.entity}.${c.column}`)) errors.push(`${at}: this picture cannot be taken away`);
    if (c.kind === 'text' && typeof c.to !== 'string') errors.push(`${at}: the new text must be text`);
    // The restaurant screen's own rule for a name (RestaurantForm: required, LENGTHS.restaurantName).
    if (c.kind === 'row' && c.entity === 'restaurants' && c.column === 'name' && (typeof c.to !== 'string' || !c.to.trim() || c.to.length > LENGTHS.restaurantName.max)) {
      errors.push(`${at}: a restaurant's name is text of 1 to ${LENGTHS.restaurantName.max} characters`);
    }
  }
  return errors;
}

/**
 * R19, as the restaurant screen does it: while the card's English alt is still
 * the old name it becomes the new one, audited as the file's own History row.
 */
async function followCardAlt(client: PoolClient, actor: AuditActor, id: string, oldName: string, newName: string): Promise<void> {
  const { rows } = await client.query<{ card: string | null; alt: string | null }>(
    `SELECT r.card_image_id::text AS card, mi.alt
       FROM restaurants r LEFT JOIN media_i18n mi ON mi.media_id = r.card_image_id AND mi.locale = $2
      WHERE r.id = $1 FOR UPDATE OF r`,
    [id, DEFAULT_LOCALE],
  );
  const card = rows[0]?.card;
  const alt = card ? followRename(rows[0].alt, oldName, newName) : null;
  if (!card || alt === null) return;
  const file = await readItem(client, MEDIA, card);
  await upsertTranslation(client, MEDIA, card, DEFAULT_LOCALE, { alt }, actor.id);
  await insertAudit(client, actor, { action: 'update', entityType: 'media', entityId: card, before: file, after: await readItem(client, MEDIA, card) });
}

/** One change, if what it replaces is still the seed's. Returns why not otherwise. The item's row is locked already. */
async function applyChange(client: PoolClient, change: PackChange, actor: AuditActor): Promise<string | null> {
  const actorId = actor.id;
  const t = TARGETS[change.entity];
  const where = `${t.key} = $1::${t.idType}`;

  if (change.kind === 'image') {
    const { rows: now } = await client.query<{ pathname: string | null }>(
      `SELECT m.pathname FROM ${t.table} x LEFT JOIN media m ON m.id = x.${change.column} WHERE x.${where}`,
      [change.id],
    );
    if (now.length === 0) return 'not found';
    if (!now[0].pathname || !isSeededFile(now[0].pathname, change.from)) return `the picture is no longer ${change.from} (now ${now[0].pathname ?? 'none'})`;
    if (change.to === null) {
      await client.query(`UPDATE ${t.table} SET ${change.column} = NULL, updated_at = now(), updated_by = $2 WHERE ${where}`, [change.id, actorId]);
      return null;
    }
    const to = change.to;
    // Code rule 2: a live picture, kept live until this commits (FOR KEY SHARE, as assertLiveMedia).
    const { rows: files } = await client.query<{ id: string; pathname: string }>(
      `SELECT id::text, pathname FROM media
        WHERE (pathname = $1::text OR right(pathname, length($1::text)) = $1::text) AND deleted_at IS NULL AND content_type <> 'application/pdf'
        ORDER BY pathname FOR KEY SHARE`,
      [to],
    );
    const file = files.find((f) => f.pathname === to) ?? files.find((f) => isSeededFile(f.pathname, to));
    if (!file) return `${to} is not a live picture of the library (apply migration 013 first)`;
    await client.query(`UPDATE ${t.table} SET ${change.column} = $2::uuid, updated_at = now(), updated_by = $3 WHERE ${where}`, [change.id, file.id, actorId]);
    return null;
  }

  if (change.kind === 'row') {
    const { rows } = await client.query<{ v: string | null }>(`SELECT ${change.column}::text AS v FROM ${t.table} WHERE ${where}`, [change.id]);
    if (rows.length === 0) return 'not found';
    if (!same(rows[0].v, change.from)) return `the value is no longer the seed's (now ${rows[0].v ?? 'empty'})`;
    await client.query(`UPDATE ${t.table} SET ${change.column} = $2, updated_at = now(), updated_by = $3 WHERE ${where}`, [change.id, change.to, actorId]);
    if (change.entity === 'restaurants' && change.column === 'name') await followCardAlt(client, actor, change.id, rows[0].v ?? '', String(change.to));
    return null;
  }

  // The default language's row: English.
  const i18n = t.i18n!;
  const { rows } = await client.query<{ v: string | null; origin: string }>(
    `SELECT ${change.column} AS v, origin FROM ${i18n.table} WHERE ${i18n.fk} = $1::${t.idType} AND locale = $2 FOR UPDATE`,
    [change.id, DEFAULT_LOCALE],
  );
  if (rows.length === 0) return 'no English row';
  if (rows[0].origin !== 'seed') return 'its English was edited in the admin';
  if (!same(rows[0].v, change.from)) return `the text is no longer the seed's (now ${rows[0].v ?? 'empty'})`;
  // Still the seed's: the pack is a newer seed, so origin stays 'seed'. Other languages keep their source_hash and so show "EN đã đổi".
  await client.query(
    `UPDATE ${i18n.table} SET ${change.column} = $3, updated_at = now(), updated_by = $4 WHERE ${i18n.fk} = $1::${t.idType} AND locale = $2`,
    [change.id, DEFAULT_LOCALE, change.to, actorId],
  );
  return null;
}

/**
 * Applies a pack in one transaction, or (dryRun) runs it and rolls back, so a
 * dry run reports exactly what an apply would do. One audit row per item it
 * changed, before and after as that item's History reads it.
 */
export async function applyContentPack(pool: Pool, actor: AuditActor, pack: ContentPack, options: { dryRun: boolean }): Promise<PackOutcome[]> {
  const errors = packErrors(pack);
  if (errors.length) throw new Error(`content pack ${pack?.id ?? '?'}: ${errors.join('; ')}`);

  const run = async (client: PoolClient) => {
    // The lists' advisory locks first, as every list editor takes its own (lockList), in one order so two runs cannot deadlock.
    const keys = [...new Set(pack.changes.flatMap((c) => TARGETS[c.entity].listKey ?? []))].sort();
    for (const key of keys) await lockList(client, key);
    const outcomes: PackOutcome[] = [];
    const audited = new Map<string, Audited & { before: object | null; changed: boolean }>();
    for (const change of pack.changes) {
      // Then the item's row, before its version is read: a save in flight commits first, and lands in `before`.
      const item = await TARGETS[change.entity].lock(client, change.id);
      if (!item) {
        outcomes.push({ change, applied: false, reason: 'not found' });
        continue;
      }
      const k = `${item.entityType}:${item.entityId}`;
      if (!audited.has(k)) audited.set(k, { ...item, before: await item.read(), changed: false });
      const reason = await applyChange(client, change, actor);
      outcomes.push(reason ? { change, applied: false, reason } : { change, applied: true });
      if (!reason) audited.get(k)!.changed = true;
    }
    for (const a of audited.values()) {
      if (!a.changed) continue;
      await insertAudit(client, actor, { action: 'update', entityType: a.entityType, entityId: a.entityId, before: a.before, after: await a.read() });
    }
    return outcomes;
  };

  if (!options.dryRun) return withTransaction(pool, run);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    return await run(client);
  } finally {
    // A dry run never commits: its writes and audit rows go, whatever happened.
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}
