import 'server-only';
import type { Pool } from 'pg';

/*
 * /admin/audit reads the audit_feed view (spec §5.2): audit_log now, joined by
 * reservation_events in phase 4 with the same columns. Newest first; rows
 * written in one transaction share `at`, so the tie-break is the source and
 * then the id as a number (ids are text in the view, hence the lpad).
 */

export const AUDIT_PAGE_SIZE = 50;

export type AuditFeedRow = {
  source: string;
  id: string;
  at: Date;
  actor_id: string | null;
  actor_label: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  locale: string | null;
  before: unknown;
  after: unknown;
};

/** One page (1-based) of the feed, and whether another page follows. */
export async function listAuditFeed(pool: Pool, page: number): Promise<{ rows: AuditFeedRow[]; hasNext: boolean }> {
  const { rows } = await pool.query<AuditFeedRow>(
    `SELECT source, id, at, actor_id, actor_label, action, entity_type, entity_id, locale, before, after
       FROM audit_feed
      ORDER BY at DESC, source DESC, lpad(id, 20, '0') DESC
      LIMIT $1 OFFSET $2`,
    [AUDIT_PAGE_SIZE + 1, (page - 1) * AUDIT_PAGE_SIZE],
  );
  return { rows: rows.slice(0, AUDIT_PAGE_SIZE), hasNext: rows.length > AUDIT_PAGE_SIZE };
}

/** id → email for the staff accounts that still exist; the feed shows the id of a removed one. */
export async function staffEmails(pool: Pool, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { rows } = await pool.query<{ id: string; email: string }>('SELECT id, email FROM staff_user WHERE id = ANY($1)', [
    [...new Set(ids)],
  ]);
  return new Map(rows.map((r) => [r.id, r.email]));
}
