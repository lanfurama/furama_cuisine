import 'server-only';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { ContentTable } from '@/lib/cache-plan';
import type { Db } from '@/lib/server/booking/rules';

/*
 * The history half of the content save flow (spec §7.4, §7.5). A list item is
 * one main row plus its *_i18n rows; audit_log.before/after hold both as an
 * ItemSnapshot, so a deleted item comes back whole, under its own id
 * (OVERRIDING SYSTEM VALUE), with every language it had.
 *
 * Every identifier below comes from an ItemDef constant, never from input or
 * from a stored snapshot: a snapshot's keys only ever reach SQL as the jsonb
 * argument of jsonb_populate_record, which ignores keys the table lacks.
 */

export type Row = Record<string, unknown>;
export type I18nRow = Row & { locale: string };

/** Version 1 of what audit_log stores for a list item. `meta` is never written back, nor part of the token. */
export type ItemSnapshot = { v: 1; row: Row; i18n: I18nRow[]; meta?: Row };

/** A list's order: every item's id and sort_order, as audit_log stores a reorder (spec §7.5). */
export type OrderSnapshot = { v: 1; order: { id: string; sort_order: number }[] };

export type ItemDef = {
  /** audit_log.entity_type: the main table's name, like phase 4's service_periods (R5). */
  entityType: string;
  table: string;
  idType: 'bigint' | 'text';
  /** Columns a save or a restore writes (not id, created_at, updated_at, updated_by). */
  columns: readonly string[];
  /** The item's translations; a list without any (social_links, sections) leaves it out. */
  i18n?: {
    table: string;
    fk: string;
    /** Translatable columns: the form writes these. */
    columns: readonly string[];
  };
  /** The tables a write touches, for tagsForSave. */
  tables: readonly ContentTable[];
};

/** The translation bookkeeping a restore puts back as it was (spec §5.1 item 3, R3); updated_at/by become the restorer's. */
const I18N_META = ['status', 'origin', 'ai_model', 'source_hash', 'reviewed_by', 'reviewed_at'] as const;

const cast = (def: ItemDef) => `::${def.idType}`;

/** The SELECT list of one item: the row as jsonb and its translations ordered by locale ('[]' without i18n). */
function itemColumns(def: ItemDef): string {
  const i18n = def.i18n
    ? `coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.locale) FROM ${def.i18n.table} t WHERE t.${def.i18n.fk} = m.id), '[]'::jsonb)`
    : `'[]'::jsonb`;
  return `to_jsonb(m) AS row, ${i18n} AS i18n`;
}

/** The item as it is now, or null when it does not exist. Call inside the transaction, after lockList. */
export async function readItem(db: Db, def: ItemDef, id: string): Promise<ItemSnapshot | null> {
  const { rows } = await db.query<{ row: Row; i18n: I18nRow[] }>(`SELECT ${itemColumns(def)} FROM ${def.table} m WHERE m.id = $1${cast(def)}`, [id]);
  return rows[0] ? { v: 1, row: rows[0].row, i18n: rows[0].i18n } : null;
}

/** Every item of the list, in display order (the list screen's per-item tokens). */
export async function readItems(db: Db, def: ItemDef): Promise<ItemSnapshot[]> {
  const { rows } = await db.query<{ row: Row; i18n: I18nRow[] }>(`SELECT ${itemColumns(def)} FROM ${def.table} m ORDER BY m.sort_order, m.id`);
  return rows.map((r) => ({ v: 1, row: r.row, i18n: r.i18n }));
}

/** Sorted keys at every level, so equal data always hashes alike whatever order Postgres or JS gave the keys. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Row)
        .sort()
        .map((k) => [k, canonical((value as Row)[k])]),
    );
  }
  return value;
}

/**
 * The concurrency token of an editor (spec §7.3 SaveBar, R2): a hash of what
 * the page showed, so any change to the item or one of its languages since
 * then is a conflict, and a write that only touched another screen's columns
 * is not. 'deleted' for an item that is gone (its restore page).
 */
export function snapshotToken(snapshot: object | null): string {
  if (!snapshot) return 'deleted';
  const { meta: _meta, ...data } = snapshot as { meta?: unknown };
  return createHash('sha256').update(JSON.stringify(canonical(data))).digest('hex').slice(0, 32);
}

/** One writer per list at a time: create, edit, show/hide, reorder, delete and restore all take it. */
export async function lockList(client: PoolClient, key: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`content:${key}`]);
}

/** A list in display order. */
export async function readOrder(db: Db, def: ItemDef): Promise<OrderSnapshot> {
  const { rows } = await db.query<{ id: string; sort_order: number }>(`SELECT id::text, sort_order FROM ${def.table} ORDER BY sort_order, id`);
  return { v: 1, order: rows };
}

/** The list's token: its ids in order. An add, a delete or another reorder since the page loaded is a conflict. */
export function orderToken(order: OrderSnapshot): string {
  return createHash('sha256')
    .update(order.order.map((o) => o.id).join(','))
    .digest('hex')
    .slice(0, 32);
}

/** Writes sort_order 10, 20, … in the order of `ids`. */
export async function writeOrder(client: PoolClient, def: ItemDef, ids: readonly string[], actorId: string): Promise<void> {
  for (const [index, id] of ids.entries()) {
    await client.query(
      `UPDATE ${def.table} SET sort_order = $2, updated_at = now(), updated_by = $3 WHERE id = $1${cast(def)} AND sort_order <> $2`,
      [id, (index + 1) * 10, actorId],
    );
  }
}

/**
 * Puts a snapshot back: the main row (inserted under its old id if it is gone,
 * else updated column by column), then exactly the snapshot's languages. A
 * language deleted since then is skipped (its FK would refuse the row). The
 * restorer becomes updated_by; created_at stays the original's.
 */
export async function writeItem(client: PoolClient, def: ItemDef, snapshot: ItemSnapshot, actorId: string): Promise<void> {
  const id = String(snapshot.row.id);
  const cols = def.columns.join(', ');
  const fromSnap = def.columns.map((c) => `r.${c}`).join(', ');
  const exists = (await client.query(`SELECT 1 FROM ${def.table} WHERE id = $1${cast(def)}`, [id])).rowCount === 1;
  if (exists) {
    // jsonb_populate_record(m, …): a column the snapshot lacks (added by a later migration) keeps today's value.
    await client.query(
      `UPDATE ${def.table} m
          SET (${cols}) = (SELECT ${fromSnap} FROM jsonb_populate_record(m, $2::jsonb) r),
              updated_at = now(), updated_by = $3
        WHERE m.id = $1${cast(def)}`,
      [id, JSON.stringify(snapshot.row), actorId],
    );
  } else {
    // A column the snapshot lacks comes back NULL here: code rule 4 (every content column added later has a DEFAULT or is nullable).
    await client.query(
      `INSERT INTO ${def.table} (id, created_at, updated_at, updated_by, ${cols})
       ${def.idType === 'bigint' ? 'OVERRIDING SYSTEM VALUE' : ''}
       SELECT r.id, coalesce(r.created_at, now()), now(), $2, ${fromSnap}
         FROM jsonb_populate_record(NULL::${def.table}, $1::jsonb) r`,
      [JSON.stringify(snapshot.row), actorId],
    );
  }
  if (def.i18n) await writeI18nRows(client, def, id, snapshot.i18n, actorId);
}

/** Replaces every language of an item with `rows` (a restore), keeping their review state (R3). */
export async function writeI18nRows(client: PoolClient, def: ItemDef, id: string, rows: readonly I18nRow[], actorId: string): Promise<void> {
  if (!def.i18n) return;
  const { table, fk } = def.i18n;
  const cols = ['locale', ...def.i18n.columns, ...I18N_META];
  await client.query(`DELETE FROM ${table} WHERE ${fk} = $1${cast(def)}`, [id]);
  if (rows.length === 0) return;
  await client.query(
    `INSERT INTO ${table} (${fk}, ${cols.join(', ')}, updated_at, updated_by)
     SELECT $1${cast(def)}, ${cols.map((c) => `r.${c}`).join(', ')}, now(), $3
       FROM jsonb_populate_recordset(NULL::${table}, $2::jsonb) r
      WHERE r.locale IN (SELECT code FROM locales)`,
    [id, JSON.stringify(rows), actorId],
  );
}

/**
 * A form save of one language (spec §5.1 item 4): its translatable columns as
 * typed (null = empty, which falls back to the default language), and the row
 * marked reviewed by a person. Other languages are left alone.
 */
export async function upsertTranslation(
  client: PoolClient,
  def: ItemDef,
  id: string,
  locale: string,
  values: Record<string, string | null>,
  actorId: string,
): Promise<void> {
  if (!def.i18n) throw new Error(`${def.entityType} has no translations`);
  const { table, fk, columns } = def.i18n;
  const written = columns.filter((c) => c in values);
  const params = [id, locale, actorId, ...written.map((c) => values[c])];
  const placeholders = written.map((_, i) => `$${i + 4}`);
  await client.query(
    `INSERT INTO ${table} (${fk}, locale, ${written.join(', ')}, status, origin, ai_model, reviewed_by, reviewed_at, updated_at, updated_by)
     VALUES ($1${cast(def)}, $2, ${placeholders.join(', ')}, 'reviewed', 'human', NULL, $3, now(), now(), $3)
     ON CONFLICT (${fk}, locale) DO UPDATE
       SET ${written.map((c) => `${c} = EXCLUDED.${c}`).join(', ')},
           status = 'reviewed', origin = 'human', ai_model = NULL, reviewed_by = $3, reviewed_at = now(), updated_at = now(), updated_by = $3`,
    params,
  );
}

/** Postgres' foreign_key_violation: a restore pointing at a restaurant or file that is gone. */
export function isForeignKeyViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23503';
}

/** unique_violation, with the constraint it names. */
export function uniqueViolation(err: unknown): string | null {
  const e = err as { code?: string; constraint?: string } | null;
  return e && e.code === '23505' ? (e.constraint ?? '') : null;
}
