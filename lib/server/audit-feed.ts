import 'server-only';
import type { Pool } from 'pg';
import { EMAIL_EVENT_LABELS, type EmailEvent } from '@/lib/email/events';

/*
 * /admin/audit reads the audit_feed view (spec §5.2, §7.4): audit_log and
 * reservation_events on one timeline, newest first. Keyset paging on
 * (at, source, id::bigint): rows written in one transaction share `at`, so
 * the source and then the numeric id break the tie. The cursor carries `at` in
 * microseconds since the epoch, exactly: a JS Date keeps only milliseconds and
 * would skip or repeat rows that share one.
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
  /** This row's position, `<µs>_<source>_<id>`, for the links to the next page. */
  cursor: string;
};

export type AuditPage = {
  rows: AuditFeedRow[];
  /** Cursor for the page of older rows, or null at the end. */
  older: string | null;
  /** Cursor for the page of newer rows, or null on the newest page. */
  newer: string | null;
};

const CURSOR = /^(\d{1,17})_(audit|reservation)_(\d{1,18})$/;

export function isAuditCursor(value: unknown): value is string {
  return typeof value === 'string' && CURSOR.test(value);
}

const SELECT = `SELECT source, id, at, actor_id, actor_label, action, entity_type, entity_id, locale, before, after,
       (extract(epoch FROM at) * 1000000)::bigint::text || '_' || source || '_' || id AS cursor
  FROM audit_feed`;
const KEY = `(at, source, id::bigint)`;
const AT = (p: string) => `timestamptz 'epoch' + ${p}::bigint * interval '1 microsecond'`;

/**
 * One page. `before`: the rows older than that cursor (the "Cũ hơn" link);
 * `after`: the rows newer than it ("Mới hơn"); neither, or a malformed
 * cursor: the newest page.
 */
export async function listAuditFeed(pool: Pool, options: { before?: string | null; after?: string | null } = {}): Promise<AuditPage> {
  const before = options.before ? CURSOR.exec(options.before) : null;
  const after = !before && options.after ? CURSOR.exec(options.after) : null;
  const limit = AUDIT_PAGE_SIZE + 1;

  if (after) {
    // Read upwards from the cursor, then show newest first like every other page.
    const { rows } = await pool.query<AuditFeedRow>(
      `${SELECT} WHERE ${KEY} > (${AT('$1')}, $2, $3::bigint) ORDER BY at, source, id::bigint LIMIT ${limit}`,
      [after[1], after[2], after[3]],
    );
    const page = rows.slice(0, AUDIT_PAGE_SIZE).reverse();
    return { rows: page, older: page.at(-1)?.cursor ?? null, newer: rows.length > AUDIT_PAGE_SIZE ? page[0].cursor : null };
  }

  const { rows } = before
    ? await pool.query<AuditFeedRow>(
        `${SELECT} WHERE ${KEY} < (${AT('$1')}, $2, $3::bigint) ORDER BY at DESC, source DESC, id::bigint DESC LIMIT ${limit}`,
        [before[1], before[2], before[3]],
      )
    : await pool.query<AuditFeedRow>(`${SELECT} ORDER BY at DESC, source DESC, id::bigint DESC LIMIT ${limit}`);
  const page = rows.slice(0, AUDIT_PAGE_SIZE);
  return {
    rows: page,
    older: rows.length > AUDIT_PAGE_SIZE ? page[page.length - 1].cursor : null,
    newer: before && page.length > 0 ? page[0].cursor : null,
  };
}

/** An entity as the log names it: a label instead of the raw id, and the screen that shows it, if any. */
export type EntityRef = { label: string; href: string | null };

/**
 * What to show for each row's entity instead of a raw id: a staff member's
 * or an invitation's email, a booking's reference (linked to the booking),
 * and an email's kind with its booking's reference, linked to that booking,
 * where "Gửi lại" left it (phase-5 ledger T7.5: it read "Email · 123"). A
 * removed account keeps its id (the log outlives the account).
 */
export async function entityLabels(
  pool: Pool,
  rows: readonly Pick<AuditFeedRow, 'entity_type' | 'entity_id'>[],
): Promise<Map<string, EntityRef>> {
  const ids = (type: string) => [...new Set(rows.filter((r) => r.entity_type === type && r.entity_id).map((r) => r.entity_id as string))];
  const numeric = (list: string[]) => list.filter((id) => /^\d{1,18}$/.test(id));
  const staff = ids('staff_user');
  const invitations = numeric(ids('staff_invitation'));
  const reservations = numeric(ids('reservation'));
  const emails = numeric(ids('email_outbox'));
  if (staff.length + invitations.length + reservations.length + emails.length === 0) return new Map();
  const { rows: found } = await pool.query<{ key: string; label: string; booking: string | null; event: string | null }>(
    `SELECT 'staff_user:' || id AS key, email AS label, NULL AS booking, NULL AS event FROM staff_user WHERE id = ANY($1::text[])
     UNION ALL SELECT 'staff_invitation:' || id, email, NULL, NULL FROM staff_invitation WHERE id = ANY($2::bigint[])
     UNION ALL SELECT 'reservation:' || id, reference, id::text, NULL FROM reservations WHERE id = ANY($3::bigint[])
     UNION ALL SELECT 'email_outbox:' || o.id, r.reference, r.id::text, o.event
                 FROM email_outbox o JOIN reservations r ON r.id = o.reservation_id WHERE o.id = ANY($4::bigint[])`,
    [staff, invitations, reservations, emails],
  );
  return new Map(
    found.map((l) => [
      l.key,
      {
        label: l.event ? `${EMAIL_EVENT_LABELS[l.event as EmailEvent] ?? l.event} · ${l.label}` : l.label,
        href: l.booking ? `/admin/reservations/${l.booking}` : null,
      },
    ]),
  );
}
