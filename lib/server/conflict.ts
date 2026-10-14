import 'server-only';
import type { PoolClient } from 'pg';
import { formatDateTimeVi } from '@/lib/admin/format';

/*
 * Optimistic concurrency for every edit screen (spec §7.4 save flow): the
 * token is updated_at in microseconds since the epoch, as text (exact, where
 * a JS Date keeps only milliseconds), and a stale token answers with who
 * changed the record last, and when.
 */

/** A timestamptz column as the concurrency token. */
export const US = (column: string) => `(extract(epoch FROM ${column}) * 1000000)::bigint::text`;

export type Conflict = { ok: false; code: 'conflict'; params: { by: string; at: string } };

/** "Vừa được {tên} thay đổi lúc {giờ}": updated_by holds the staff id (spec §5.1.6). */
export async function conflictBy(client: PoolClient, staffId: string | null, at: Date): Promise<Conflict> {
  const { rows } = staffId ? await client.query<{ name: string }>('SELECT name FROM staff_user WHERE id = $1', [staffId]) : { rows: [] };
  return { ok: false, code: 'conflict', params: { by: rows[0]?.name ?? 'người khác', at: formatDateTimeVi(at) } };
}

/**
 * A conflict on a record with a History (spec §7.5): named for the newest
 * audit row of that record (entity_id null: a list's order), which is who
 * changed it last, even by a write that leaves the row's updated_by alone
 * (R19: a restaurant's rename rewrites its card picture's alt; a string
 * reset to its default has no row left) or that is not the row's own (a
 * reorder). With no History yet, the row's updated_by (7A review).
 */
export async function conflictFromHistory(
  client: PoolClient,
  entityType: string,
  entityId: string | null,
  fallback: { by: string | null; at: Date },
  /** The language of a per-language row (content_strings): the newest write of that language only. */
  locale?: string,
): Promise<Conflict> {
  const { rows } = await client.query<{ actor_id: string | null; at: Date }>(
    `SELECT actor_id, at FROM audit_log
      WHERE entity_type = $1 AND entity_id IS NOT DISTINCT FROM $2 AND ($3::text IS NULL OR locale = $3)
      ORDER BY at DESC, id DESC LIMIT 1`,
    [entityType, entityId, locale ?? null],
  );
  return rows[0] ? conflictBy(client, rows[0].actor_id, rows[0].at) : conflictBy(client, fallback.by, fallback.at);
}
