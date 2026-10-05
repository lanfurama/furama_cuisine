import 'server-only';
import type { PoolClient } from 'pg';
import type { Db } from '@/lib/server/booking/rules';
import type { ItemDef } from './snapshot';

/*
 * Per-record history (spec §7.5): audit_log by (entity_type, entity_id),
 * newest first, for Editor and Admin alike (content:read; the site-wide log
 * stays Admin-only). A list's reorders are the rows with entity_id NULL.
 */

export type HistoryEntry = {
  id: string;
  at: Date;
  action: string;
  /** The staff member's current name, else the email the row kept, else "Hệ thống" (seed, cron). */
  actor: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

/** No pager yet (outline risk 9): the 30 newest rows. */
export const HISTORY_LIMIT = 30;

export async function listHistory(db: Db, entityType: string, entityId: string | null, limit = HISTORY_LIMIT): Promise<HistoryEntry[]> {
  const { rows } = await db.query<HistoryEntry>(
    `SELECT a.id::text, a.at, a.action, a.before, a.after, coalesce(s.name, a.actor_email, 'Hệ thống') AS actor
       FROM audit_log a
       LEFT JOIN staff_user s ON s.id = a.actor_id
      WHERE a.entity_type = $1 AND a.entity_id IS NOT DISTINCT FROM $2
      ORDER BY a.at DESC, a.id DESC
      LIMIT $3`,
    [entityType, entityId, limit],
  );
  return rows;
}

/** `locale`: set on a per-language row (content_strings), NULL on an item's (its snapshot holds every language). */
export type AuditSnapshotRow = { entity_type: string; entity_id: string | null; locale: string | null; action: string; before: unknown; after: unknown };

/** One audit row, for a restore. */
export async function getAuditRow(client: PoolClient, auditId: string): Promise<AuditSnapshotRow | null> {
  const { rows } = await client.query<AuditSnapshotRow>('SELECT entity_type, entity_id, locale, action, before, after FROM audit_log WHERE id = $1::bigint', [auditId]);
  return rows[0] ?? null;
}

export type DeletedItem = { id: string; at: Date; actor: string; before: Record<string, unknown> };

/** Items of a list deleted and not restored since: each one's latest delete row, newest first. */
export async function listDeleted(db: Db, def: ItemDef, limit = 20): Promise<DeletedItem[]> {
  const { rows } = await db.query<DeletedItem>(
    `SELECT DISTINCT ON (a.entity_id) a.entity_id AS id, a.at, coalesce(s.name, a.actor_email, 'Hệ thống') AS actor, a.before
       FROM audit_log a
       LEFT JOIN staff_user s ON s.id = a.actor_id
      WHERE a.entity_type = $1 AND a.action = 'delete' AND a.entity_id IS NOT NULL AND a.before IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM ${def.table} t WHERE t.id::text = a.entity_id)
      ORDER BY a.entity_id, a.at DESC, a.id DESC`,
    [def.entityType],
  );
  return rows.sort((x, y) => +new Date(y.at) - +new Date(x.at)).slice(0, limit);
}

/** Who saved a record last, by name ("Sửa lần cuối bởi …"); null for the seed or a removed account. */
export async function staffName(db: Db, staffId: unknown): Promise<string | null> {
  if (typeof staffId !== 'string' || !staffId) return null;
  const { rows } = await db.query<{ name: string }>('SELECT name FROM staff_user WHERE id = $1', [staffId]);
  return rows[0]?.name ?? null;
}
