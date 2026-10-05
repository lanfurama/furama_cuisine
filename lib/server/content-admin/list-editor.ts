import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { LIMITS, type LimitKey } from '@/lib/admin/content-rules';
import { insertAudit, withTransaction, type AuditActor } from '@/lib/server/audit';
import { conflictBy, type Conflict } from '@/lib/server/booking/config';
import { assertLiveMedia, reviveMedia } from '@/lib/server/media/library';
import { getAuditRow } from './history';
import {
  isForeignKeyViolation,
  isRestrictViolation,
  isRuleViolation,
  lockList,
  orderToken,
  readItem,
  readOrder,
  snapshotToken,
  upsertTranslation,
  writeItem,
  writeOrder,
  type I18nRow,
  type ItemDef,
  type ItemSnapshot,
  type OrderSnapshot,
  type Row,
} from './snapshot';

/*
 * The save flow of a list editor (spec §7.4, §7.5, §6.5), written once for
 * every list (offers, experiences, stories, hero slides, cuisines,
 * destinations, nav items, social links): each write takes the list's
 * advisory lock, checks the page's token, applies today's rules (the same on
 * a save and a restore: code rule 5), writes the main row and its *_i18n
 * rows, and records before/after snapshots in audit_log in the same
 * transaction. The Server Action then expires tagsForSave(def.tables).
 *
 * The list's own columns come from `toRow`, its translations from `toI18n`,
 * its extra rules from `validate`: every SQL identifier is still the
 * ItemDef's, and form values reach SQL as one jsonb parameter of
 * jsonb_populate_record, typed by the table itself.
 */

export type ListFailure =
  | Conflict
  | { ok: false; code: 'not_found' }
  | { ok: false; code: 'limit'; params: { max: string } }
  | { ok: false; code: 'invalid'; fieldErrors: Record<string, string[]> }
  | { ok: false; code: 'missing_reference' };
export type ListResult<T = null> = { ok: true; data: T } | ListFailure;

/** A form's translations, by language then column: `{ en: { title: '…', schedule: null } }`. */
export type Translations = Record<string, Record<string, string | null>>;

/** A version about to be written: the main row's values and its translations. */
export type Candidate = { row: Row; i18n: readonly I18nRow[] };

export type ListEditorOptions<I> = {
  /** The advisory lock's key: pg_advisory_xact_lock(hashtext('content:' || listKey)). */
  listKey: string;
  /** Spec §6.5: the most items shown at once (is_published), checked on create, show, edit and restore. */
  limit?: LimitKey;
  /** The main row's values from the form, by column (sort_order and bookkeeping excluded). */
  toRow: (input: I) => Row;
  /** The form's translations; omitted for a list without i18n. */
  toI18n?: (input: I) => Translations;
  /**
   * Today's rules on the version about to be written, beyond the limit: a
   * save (a form the schema already checked) or a restore (a stored
   * snapshot, which nothing checked). Null when it may be written.
   */
  validate?: (client: PoolClient, candidate: Candidate, mode: 'save' | 'restore') => Promise<ListFailure | null>;
  /** Extra `meta` for the delete's audit row, read before the DELETE in its transaction (R9: the bookings it unlinks). */
  beforeDelete?: (client: PoolClient, id: string, actor: AuditActor) => Promise<Row | null>;
  /**
   * Why this item cannot be deleted, read in the delete's transaction, or
   * null: rows that point at it (a destination's restaurants, a cuisine's
   * restaurants), including ones an ON DELETE CASCADE would silently take
   * with it (a destination's closures and recipients), which a restore of
   * the item could never bring back.
   */
  refuseDelete?: (client: PoolClient, id: string) => Promise<ListFailure | null>;
  /**
   * A rule about the whole list as a write leaves it (spec §6.5 "slide 1 bắt
   * buộc có ảnh crop cho mobile": which slide is first depends on every
   * item's order and switch). Runs after every write, in its transaction; a
   * failure rolls the write back and is the write's answer.
   */
  checkList?: (client: PoolClient) => Promise<ListFailure | null>;
};

export type RestoreInput = { id: string; auditId: string; side: 'before' | 'after'; token: string };
export type RestoreOrderInput = { auditId: string; side: 'before' | 'after'; token: string };

const fail = (x: { snapshot: ItemSnapshot } | ListFailure): x is ListFailure => 'ok' in x;

function isItemSnapshot(value: unknown, id: string): value is ItemSnapshot {
  const s = value as ItemSnapshot | null;
  return !!s && s.v === 1 && typeof s.row === 'object' && s.row !== null && String(s.row.id) === id && Array.isArray(s.i18n);
}

/** checkList's refusal, thrown inside the transaction so it rolls back, and returned as the write's result. */
class ListRefusal extends Error {
  constructor(readonly failure: ListFailure) {
    super(failure.code);
  }
}

function isOrderSnapshot(value: unknown): value is OrderSnapshot {
  const s = value as OrderSnapshot | null;
  return !!s && s.v === 1 && Array.isArray(s.order);
}

/** The translations a form's input becomes, as rows (the EN one first), for validate(). */
function i18nRows(translations: Translations): I18nRow[] {
  return Object.entries(translations).map(([locale, values]) => ({ ...values, locale }));
}

/** The fieldErrors key of an error about the whole item rather than one field. */
export const WHOLE_ITEM = '_';
/** A restored version that a CHECK or NOT NULL of today's schema refuses. */
export const VERSION_INVALID = 'Phiên bản này không còn hợp lệ theo luật hôm nay.';

/** The field error of a save that points at a file no longer in the library (code rule 2). */
export const MEDIA_GONE = 'File này đã bị xóa khỏi thư viện. Hãy chọn file khác.';

/** A new item whose text id (a slug: destinations, cuisines) another item has. */
export const ID_TAKEN = 'Mã này đã có. Hãy chọn mã khác.';
/** A delete that a foreign key refused after refuseDelete found nothing (a row added by a path it does not know). */
export const STILL_IN_USE = 'Mục này còn được dùng ở nơi khác nên không xóa được. Hãy ẩn nó thay vì xóa.';

export function makeListEditor<I>(def: ItemDef, options: ListEditorOptions<I>) {
  const cast = `::${def.idType}`;
  const columnsOf = (row: Row) => Object.keys(row).filter((c) => def.columns.includes(c) && c !== 'sort_order');

  async function shownCount(client: PoolClient, exceptId: string | null): Promise<number> {
    const { rows } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${def.table} WHERE is_published AND ($1${cast} IS NULL OR id <> $1${cast})`,
      [exceptId],
    );
    return rows[0].n;
  }

  /** The limit's refusal when `published` would make one shown item too many, else null. */
  async function overLimit(client: PoolClient, published: unknown, exceptId: string | null): Promise<ListFailure | null> {
    if (!options.limit || published !== true) return null;
    const { max } = LIMITS[options.limit];
    return (await shownCount(client, exceptId)) + 1 > max ? { ok: false, code: 'limit', params: { max: String(max) } } : null;
  }

  /** The current row for a write, or the refusal: gone, or changed since the page's token. */
  async function lockedItem(client: PoolClient, id: string, token: string): Promise<{ snapshot: ItemSnapshot } | ListFailure> {
    const { rows } = await client.query<{ updated_by: string | null; updated_at: Date }>(
      `SELECT updated_by, updated_at FROM ${def.table} WHERE id = $1${cast} FOR UPDATE`,
      [id],
    );
    if (!rows[0]) return { ok: false, code: 'not_found' };
    const snapshot = (await readItem(client, def, id))!;
    if (snapshotToken(snapshot) !== token) return conflictBy(client, rows[0].updated_by, rows[0].updated_at);
    return { snapshot };
  }

  async function listConflict(client: PoolClient): Promise<Conflict> {
    const { rows } = await client.query<{ updated_by: string | null; updated_at: Date }>(
      `SELECT updated_by, updated_at FROM ${def.table} ORDER BY updated_at DESC LIMIT 1`,
    );
    return conflictBy(client, rows[0]?.updated_by ?? null, rows[0]?.updated_at ?? new Date());
  }

  /** The media ids a row points at, by column (ItemDef.media). */
  const mediaOf = (row: Row) =>
    (def.media ?? []).flatMap((m) => (typeof row[m.column] === 'string' && row[m.column] !== '' ? [{ ...m, id: String(row[m.column]) }] : []));

  /**
   * Code rule 2: the files a save points at are live and of the column's kind
   * (a picture column never takes a PDF), and stay so until it commits
   * (assertLiveMedia's FOR KEY SHARE waits for, or blocks, a delete).
   */
  async function deadMedia(client: PoolClient, row: Row): Promise<ListFailure | null> {
    const refs = mediaOf(row);
    const fieldErrors: Record<string, string[]> = {};
    for (const kind of ['image', 'pdf'] as const) {
      const ofKind = refs.filter((r) => r.kind === kind);
      const dead = await assertLiveMedia(
        client,
        ofKind.map((r) => r.id),
        kind,
      );
      for (const r of ofKind.filter((x) => dead.includes(x.id))) fieldErrors[r.field ?? r.column] = [MEDIA_GONE];
    }
    return Object.keys(fieldErrors).length ? { ok: false, code: 'invalid', fieldErrors } : null;
  }

  async function writeTranslations(client: PoolClient, id: string, input: I, actorId: string): Promise<void> {
    if (!options.toI18n) return;
    for (const [locale, values] of Object.entries(options.toI18n(input))) await upsertTranslation(client, def, id, locale, values, actorId);
  }

  async function audited(client: PoolClient, actor: AuditActor, action: string, id: string, before: ItemSnapshot | null, after: unknown) {
    await insertAudit(client, actor, { action, entityType: def.entityType, entityId: id, before, after });
  }

  /** The list as this write leaves it must pass checkList, or the whole write rolls back. */
  async function settled(client: PoolClient): Promise<void> {
    const failure = await options.checkList?.(client);
    if (failure) throw new ListRefusal(failure);
  }

  /** One write: its transaction, with a checkList refusal as its answer. */
  async function write<T>(pool: Pool, work: (client: PoolClient) => Promise<ListResult<T>>): Promise<ListResult<T>> {
    try {
      return await withTransaction(pool, work);
    } catch (err) {
      if (err instanceof ListRefusal) return err.failure;
      throw err;
    }
  }

  return {
    /**
     * "Thêm …": appended to the end of the list. A list whose id is text (a
     * slug) takes it from toRow's `id`, once: no save changes it later (it is
     * in URLs and filters), and one already taken is the id field's error.
     */
    async create(pool: Pool, actor: AuditActor, input: I): Promise<ListResult<{ id: string }>> {
      return write(pool, async (client) => {
        await lockList(client, options.listKey);
        const row = options.toRow(input);
        const textId = def.idType === 'text' ? String(row.id ?? '') : null;
        // Under the list's lock, as every write of the list: no other create can take the id between this check and the INSERT.
        if (textId !== null && (await client.query(`SELECT 1 FROM ${def.table} WHERE id = $1${cast}`, [textId])).rowCount) {
          return { ok: false, code: 'invalid', fieldErrors: { id: [ID_TAKEN] } };
        }
        const refused =
          (await options.validate?.(client, { row, i18n: options.toI18n ? i18nRows(options.toI18n(input)) : [] }, 'save')) ??
          (await overLimit(client, row.is_published, null)) ??
          (await deadMedia(client, row));
        if (refused) return refused;
        const cols = textId !== null ? ['id', ...columnsOf(row)] : columnsOf(row);
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO ${def.table} (${cols.join(', ')}, sort_order, updated_by)
           SELECT ${cols.map((c) => `r.${c}`).join(', ')}, (SELECT coalesce(max(sort_order), 0) + 10 FROM ${def.table}), $2
             FROM jsonb_populate_record(NULL::${def.table}, $1::jsonb) r
           RETURNING id::text`,
          [JSON.stringify(row), actor.id],
        );
        const id = rows[0].id;
        await writeTranslations(client, id, input, actor.id);
        await settled(client);
        await audited(client, actor, 'create', id, null, await readItem(client, def, id));
        return { ok: true, data: { id } };
      });
    },

    async update(pool: Pool, actor: AuditActor, id: string, token: string, input: I): Promise<ListResult> {
      return write(pool, async (client) => {
        await lockList(client, options.listKey);
        const locked = await lockedItem(client, id, token);
        if (fail(locked)) return locked;
        const row = options.toRow(input);
        const refused =
          (await options.validate?.(client, { row, i18n: options.toI18n ? i18nRows(options.toI18n(input)) : [] }, 'save')) ??
          (await overLimit(client, row.is_published, id)) ??
          (await deadMedia(client, row));
        if (refused) return refused;
        const cols = columnsOf(row);
        await client.query(
          `UPDATE ${def.table} m
              SET (${cols.join(', ')}) = (SELECT ${cols.map((c) => `r.${c}`).join(', ')} FROM jsonb_populate_record(m, $2::jsonb) r),
                  updated_at = now(), updated_by = $3
            WHERE m.id = $1${cast}`,
          [id, JSON.stringify(row), actor.id],
        );
        await writeTranslations(client, id, input, actor.id);
        await settled(client);
        await audited(client, actor, 'update', id, locked.snapshot, await readItem(client, def, id));
        return { ok: true, data: null };
      });
    },

    /**
     * The list's show/hide switch for one item: an update of that item alone,
     * under the same rules as a save of it (a rule may depend on the switch:
     * at most one destination teaser shown).
     */
    async setPublished(pool: Pool, actor: AuditActor, id: string, token: string, published: boolean): Promise<ListResult> {
      return write(pool, async (client) => {
        await lockList(client, options.listKey);
        const locked = await lockedItem(client, id, token);
        if (fail(locked)) return locked;
        const candidate = { row: { ...locked.snapshot.row, is_published: published }, i18n: locked.snapshot.i18n };
        const limited = (await options.validate?.(client, candidate, 'save')) ?? (await overLimit(client, published, id));
        if (limited) return limited;
        await client.query(`UPDATE ${def.table} SET is_published = $2, updated_at = now(), updated_by = $3 WHERE id = $1${cast}`, [id, published, actor.id]);
        await settled(client);
        await audited(client, actor, 'update', id, locked.snapshot, await readItem(client, def, id));
        return { ok: true, data: null };
      });
    },

    /** "Lưu thứ tự": `ids` is the whole list in its new order; the audit row keeps the whole old order (spec §7.5). */
    async reorder(pool: Pool, actor: AuditActor, token: string, ids: readonly string[]): Promise<ListResult> {
      return write(pool, async (client) => {
        await lockList(client, options.listKey);
        const before = await readOrder(client, def);
        const sameSet = ids.length === before.order.length && new Set(ids).size === ids.length && ids.every((id) => before.order.some((o) => o.id === id));
        if (orderToken(before) !== token || !sameSet) return listConflict(client);
        await writeOrder(client, def, ids, actor.id);
        await settled(client);
        await insertAudit(client, actor, { action: 'reorder', entityType: def.entityType, entityId: null, before, after: await readOrder(client, def) });
        return { ok: true, data: null };
      });
    },

    async remove(pool: Pool, actor: AuditActor, id: string, token: string): Promise<ListResult<{ meta: Row | null }>> {
      try {
        return await write(pool, async (client): Promise<ListResult<{ meta: Row | null }>> => {
          await lockList(client, options.listKey);
          const locked = await lockedItem(client, id, token);
          if (fail(locked)) return locked;
          const refused = await options.refuseDelete?.(client, id);
          if (refused) return refused;
          const meta = (await options.beforeDelete?.(client, id, actor)) ?? null;
          await client.query(`DELETE FROM ${def.table} WHERE id = $1${cast}`, [id]);
          await settled(client);
          await audited(client, actor, 'delete', id, meta ? { ...locked.snapshot, meta } : locked.snapshot, null);
          return { ok: true, data: { meta } };
        });
      } catch (err) {
        // A row refuseDelete does not know still points at it: NO ACTION raises 23503, RESTRICT 23001 (outline F2).
        // Refused, the transaction rolled back.
        if (isForeignKeyViolation(err) || isRestrictViolation(err)) return { ok: false, code: 'invalid', fieldErrors: { [WHOLE_ITEM]: [STILL_IN_USE] } };
        throw err;
      }
    },

    /**
     * "Khôi phục phiên bản này" (spec §7.5): the same flow as a save, with
     * action 'restore'. `token` is the record's as the page showed it
     * ('deleted' for a deleted one), so restoring over someone's newer edit is
     * a conflict. The version must pass today's rules (code rule 5); one that
     * points at a row that is gone cannot come back (missing_reference). A
     * file it shows that is in the trash leaves the trash with it (C7).
     */
    async restore(pool: Pool, actor: AuditActor, input: RestoreInput): Promise<ListResult> {
      try {
        return await write(pool, async (client): Promise<ListResult> => {
          await lockList(client, options.listKey);
          const audit = await getAuditRow(client, input.auditId);
          const snapshot = audit?.[input.side];
          if (!audit || audit.entity_type !== def.entityType || audit.entity_id !== input.id || !isItemSnapshot(snapshot, input.id)) {
            return { ok: false, code: 'not_found' };
          }
          const { rows } = await client.query<{ updated_by: string | null; updated_at: Date }>(
            `SELECT updated_by, updated_at FROM ${def.table} WHERE id = $1${cast} FOR UPDATE`,
            [input.id],
          );
          const current = rows[0] ? await readItem(client, def, input.id) : null;
          if (snapshotToken(current) !== input.token) {
            return rows[0] ? conflictBy(client, rows[0].updated_by, rows[0].updated_at) : { ok: false, code: 'not_found' };
          }
          const refused =
            (await options.validate?.(client, { row: snapshot.row, i18n: snapshot.i18n }, 'restore')) ??
            (await overLimit(client, snapshot.row.is_published, input.id));
          if (refused) return refused;
          // C7: a file this version shows that is now in the trash comes back with it; a purged one cannot.
          if ((await reviveMedia(client, actor, mediaOf(snapshot.row).map((r) => r.id))).length > 0) return { ok: false, code: 'missing_reference' };
          const { meta: _meta, ...data } = snapshot;
          await writeItem(client, def, data, actor.id);
          await settled(client);
          const after = await readItem(client, def, input.id);
          await audited(client, actor, 'restore', input.id, current, after && { ...after, meta: { restored_from: input.auditId } });
          return { ok: true, data: null };
        });
      } catch (err) {
        if (isForeignKeyViolation(err)) return { ok: false, code: 'missing_reference' };
        // A stored version that today's CHECK or NOT NULL refuses (code rule 5): refused cleanly, the transaction rolled back.
        if (isRuleViolation(err)) return { ok: false, code: 'invalid', fieldErrors: { [WHOLE_ITEM]: [VERSION_INVALID] } };
        throw err;
      }
    },

    /** A reorder row's order back: ids still in the list take their old places; items added since keep theirs after them. */
    async restoreOrder(pool: Pool, actor: AuditActor, input: RestoreOrderInput): Promise<ListResult> {
      return write(pool, async (client): Promise<ListResult> => {
        await lockList(client, options.listKey);
        const audit = await getAuditRow(client, input.auditId);
        const snapshot = audit?.[input.side];
        if (!audit || audit.entity_type !== def.entityType || audit.entity_id !== null || !isOrderSnapshot(snapshot)) {
          return { ok: false, code: 'not_found' };
        }
        const before = await readOrder(client, def);
        if (orderToken(before) !== input.token) return listConflict(client);
        const now = new Set(before.order.map((o) => o.id));
        const kept = snapshot.order.map((o) => String(o.id)).filter((id) => now.has(id));
        const ids = [...kept, ...before.order.map((o) => o.id).filter((id) => !kept.includes(id))];
        await writeOrder(client, def, ids, actor.id);
        await settled(client);
        await insertAudit(client, actor, { action: 'restore', entityType: def.entityType, entityId: null, before, after: await readOrder(client, def) });
        return { ok: true, data: null };
      });
    },
  };
}
