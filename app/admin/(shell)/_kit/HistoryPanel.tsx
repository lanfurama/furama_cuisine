import { auditActionLabel } from '@/lib/admin/audit-labels';
import { formatDateTimeVi } from '@/lib/admin/format';
import { changedFields, restoreChoices, type HistoryRow, type Snap } from '@/lib/admin/history';
import type { ActionResult } from '@/lib/server/action-result';
import type { HistoryEntry } from '@/lib/server/content-admin/history';
import { snapshotToken } from '@/lib/server/content-admin/snapshot';
import { RestoreButton } from './RestoreButton';
import { RestoreOutcome } from './RestoreOutcome';

/*
 * The History tab of a record (spec §7.5), drawn on the server from
 * audit_log by (entity_type, entity_id): newest first, who, when, what
 * changed, and the versions it can bring back (lib/admin/history.ts decides
 * which). The page passes the entries it read and the record's current token
 * ('deleted' when it is gone), and the editor's restore action.
 */
export function HistoryPanel({
  title = 'Lịch sử',
  headingId,
  entries,
  currentToken,
  recordId,
  labels,
  restore,
  describe,
  tokenOf = snapshotToken,
}: {
  title?: string;
  /** Unique on the page (Cache Components keeps a left page mounted, so make it the record's). */
  headingId: string;
  entries: readonly HistoryEntry[];
  currentToken: string;
  /** Posted as `id` with every restore. */
  recordId: string;
  /** Field → Vietnamese name, in display order; `list:<key>` for an aggregate's child lists. */
  labels: Record<string, string>;
  restore: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  /** A one-line summary for rows whose snapshots are not an item's (a list's order). */
  describe?: (entry: HistoryEntry) => string;
  /** How a stored version compares with currentToken: an item's snapshot hash, or a list's order (orderToken). */
  tokenOf?: (snapshot: never) => string;
}) {
  // Only a snapshot (v 1: an item's, or a list's order) is a version the restore actions accept; any other shape offers nothing.
  const version = (s: unknown): Snap => ((s as { v?: unknown } | null)?.v === 1 ? (s as Snap) : null);
  const rows: HistoryRow[] = entries.map((e) => ({ id: e.id, action: e.action, before: version(e.before), after: version(e.after) }));
  const choices = restoreChoices(rows, currentToken, (s) => tokenOf(s as never));
  return (
    <section className="a-history" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      {entries.length === 0 ? (
        <p className="a-muted">Chưa có thay đổi nào được ghi lại.</p>
      ) : (
        <RestoreOutcome>
          <ol className="a-history-list">
            {entries.map((e, i) => {
              const when = formatDateTimeVi(e.at);
              const fields = describe ? describe(e) : changedFields(e.before, e.after, labels).join(', ');
              return (
                <li key={e.id} className="a-history-item">
                  <p>
                    <strong>{auditActionLabel(e.action)}</strong> · {e.actor} · <time dateTime={new Date(e.at).toISOString()}>{when}</time>
                  </p>
                  {fields ? <p className="a-muted">{describe ? fields : `Đổi: ${fields}`}</p> : null}
                  {e.after && tokenOf(e.after as never) === currentToken ? <p className="a-muted">Đây là phiên bản hiện tại.</p> : null}
                  {choices[i].length ? (
                    <div className="a-actions">
                      {choices[i].map((o) => (
                        <RestoreButton key={o.side} action={restore} id={recordId} auditId={e.id} side={o.side} token={currentToken} label={o.label} when={when} />
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </RestoreOutcome>
      )}
    </section>
  );
}
