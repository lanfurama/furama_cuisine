import { formatDateTimeVi } from '@/lib/admin/format';
import type { ActionResult } from '@/lib/server/action-result';
import type { DeletedItem } from '@/lib/server/content-admin/history';
import { RestoreButton } from './RestoreButton';
import { RestoreOutcome } from './RestoreOutcome';

/*
 * "Đã xóa gần đây" of a list screen (spec §7.5): each item deleted and not
 * restored since, who deleted it and when, and "Khôi phục mục đã xóa", which
 * brings it back under its own id and in its old place (the list's restore
 * action, side 'before' of the delete row, token 'deleted'). A server
 * component: the page names each item from its stored version (`name`).
 */
export function DeletedList({
  headingId,
  title = 'Đã xóa gần đây',
  empty,
  deleted,
  name,
  restore,
}: {
  headingId: string;
  title?: string;
  empty: string;
  deleted: readonly DeletedItem[];
  /** The deleted item's name, from its version as it was. */
  name: (before: Record<string, unknown>, id: string) => string;
  restore: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
}) {
  return (
    <section className="a-section-card" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      <RestoreOutcome>
        {deleted.length === 0 ? (
          <p className="a-muted">{empty}</p>
        ) : (
          <ul className="a-list">
            {deleted.map((d) => {
              const when = formatDateTimeVi(d.at);
              return (
                <li key={d.id} className="a-list-item">
                  <span>
                    {name(d.before, d.id)} · xóa bởi {d.actor} lúc {when}
                  </span>
                  <RestoreButton action={restore} id={d.id} auditId={d.auditId} side="before" token="deleted" label="Khôi phục mục đã xóa" when={when} />
                </li>
              );
            })}
          </ul>
        )}
      </RestoreOutcome>
    </section>
  );
}

/** The EN value of one translatable column in a stored version (ItemSnapshot.i18n), for a deleted item's name. */
export function enOf(before: Record<string, unknown>, column: string): string | null {
  const row = (before.i18n as { locale: string; [k: string]: unknown }[] | undefined)?.find((r) => r.locale === 'en');
  return typeof row?.[column] === 'string' && row[column] ? String(row[column]) : null;
}
