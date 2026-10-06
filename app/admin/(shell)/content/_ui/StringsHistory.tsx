import { auditActionLabel } from '@/lib/admin/audit-labels';
import { formatDateTimeVi } from '@/lib/admin/format';
import { restoreChoices, stringHistoryRow, type Snap } from '@/lib/admin/history';
import { toBcp47 } from '@/lib/i18n/locales';
import type { AdminScreen } from '@/lib/i18n/registry';
import type { HistoryEntry } from '@/lib/server/content-admin/history';
import type { StringField } from '@/lib/server/content/strings-admin';
import { RestoreButton } from '../../_kit/RestoreButton';
import { RestoreOutcome } from '../../_kit/RestoreOutcome';
import { restoreScreenString } from '../actions';

/*
 * The History of one string screen (spec §7.5): the newest changes of its
 * keys, who and when, the text before and after, and the versions each row
 * brings back (lib/admin/history.ts restoreChoices, compared by the text).
 * A restore posts the key's row token ('' while the default shows), so a
 * restore over a newer edit of that key is a conflict like a save. One
 * language's rows, restored in that language.
 */
export function StringsHistory({
  screen,
  entries,
  fields,
  locale,
}: {
  screen: AdminScreen;
  /** The language these rows are of (the panel's). */
  locale: string;
  entries: readonly (HistoryEntry & { key: string })[];
  fields: readonly StringField[];
}) {
  const byKey = new Map(fields.map((f) => [f.key as string, f]));
  const headingId = `strings-${screen}-history`;
  return (
    <section className="a-history" aria-labelledby={headingId}>
      <h2 id={headingId}>Lịch sử</h2>
      {entries.length === 0 ? (
        <p className="a-muted">Chưa có thay đổi nào được ghi lại.</p>
      ) : (
        <RestoreOutcome>
          <ol className="a-history-list">
            {entries.map((e) => {
              const field = byKey.get(e.key);
              if (!field) return null;
              const when = formatDateTimeVi(e.at);
              const row = stringHistoryRow({ id: e.id, action: e.action, before: e.before as Snap, after: e.after as Snap });
              const [choices] = restoreChoices([row], field.value, (s) => String((s as { value?: unknown } | null)?.value ?? ''));
              const text = (s: unknown) => String((s as { value?: unknown } | null)?.value ?? '');
              return (
                <li key={e.id} className="a-history-item">
                  <p>
                    <strong>{field.def.label}</strong> · {auditActionLabel(e.action)} · {e.actor} · <time dateTime={new Date(e.at).toISOString()}>{when}</time>
                  </p>
                  <p className="a-muted">
                    <span lang={toBcp47(locale)}>{text(e.before) || '(trống)'}</span> → <span lang={toBcp47(locale)}>{text(e.after) || '(trống)'}</span>
                  </p>
                  {choices.length ? (
                    <div className="a-actions">
                      {choices.map((c) => (
                        <RestoreButton
                          key={c.side}
                          action={restoreScreenString}
                          id={field.key}
                          auditId={e.id}
                          side={c.side}
                          token={field.token}
                          label={c.label}
                          when={`${field.def.label}, ${when}`}
                          extra={{ locale }}
                        />
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
