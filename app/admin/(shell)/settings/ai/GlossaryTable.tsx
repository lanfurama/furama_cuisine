'use client';

import { useActionState, useId, useState } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import { FieldError, FormMessage, invalidField } from '../../_ui/FormMessage';
import { deleteGlossaryAction, saveGlossaryAction } from './actions';

export type GlossaryRow = { id: string | null; term: string; mode: 'keep' | 'map'; locale: string | null; target: string | null; auto?: boolean };
export type GlossaryLocale = { code: string; name: string };

/*
 * "Thuật ngữ" (spec §9.2, R9-6): the terms the translator keeps or renames.
 * Restaurant names appear as read-only rows (no id, no buttons): the
 * translator adds them itself, so a rename in Nhà hàng needs nothing here.
 * Like RecipientEditor, the fields remount on the row's content (or after
 * each add) so they never post stale values, and the message survives.
 */
export function GlossaryTable({ entries, locales }: { entries: GlossaryRow[]; locales: GlossaryLocale[] }) {
  const localeName = new Map(locales.map((l) => [l.code, l.name]));
  return (
    <>
      <div className="a-table-scroll">
        <table className="a-table" aria-label="Thuật ngữ AI">
          <thead>
            <tr>
              <th scope="col">Thuật ngữ</th>
              <th scope="col">Cách xử lý</th>
              <th scope="col">Ngôn ngữ</th>
              <th scope="col">Đổi thành</th>
              <th scope="col">
                <span className="a-visually-hidden">Thao tác</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={5}>Chưa có thuật ngữ nào.</td>
              </tr>
            ) : null}
            {entries.map((e) =>
              e.id === null ? (
                <tr key={`auto-${e.term}`} data-auto="true">
                  <th scope="row">{e.term}</th>
                  <td>Giữ nguyên</td>
                  <td>Mọi ngôn ngữ</td>
                  <td>—</td>
                  <td>
                    <span className="a-tag">Tên nhà hàng (tự động)</span>
                  </td>
                </tr>
              ) : (
                <GlossaryRowView key={`${e.id}-${e.term}-${e.mode}-${e.locale}-${e.target}`} entry={e} id={e.id} locales={locales} localeName={localeName} />
              ),
            )}
          </tbody>
        </table>
      </div>
      <h3>Thêm thuật ngữ</h3>
      <GlossaryEditor locales={locales} entry={null} />
    </>
  );
}

function GlossaryRowView({ entry, id, locales, localeName }: { entry: GlossaryRow; id: string; locales: GlossaryLocale[]; localeName: Map<string, string> }) {
  return (
    <tr>
      <th scope="row">{entry.term}</th>
      <td>{entry.mode === 'keep' ? 'Giữ nguyên' : 'Đổi thành…'}</td>
      <td>{entry.locale ? (localeName.get(entry.locale) ?? entry.locale) : 'Mọi ngôn ngữ'}</td>
      <td>{entry.mode === 'map' ? entry.target : '—'}</td>
      <td>
        <details>
          <summary>Sửa</summary>
          <GlossaryEditor locales={locales} entry={{ ...entry, id }} />
        </details>
        <DeleteGlossary id={id} term={entry.term} />
      </td>
    </tr>
  );
}

function GlossaryEditor({ locales, entry }: { locales: GlossaryLocale[]; entry: (GlossaryRow & { id: string }) | null }) {
  const [state, action, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(saveGlossaryAction, null);
  const [added, setAdded] = useState(0);
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok && !entry) setAdded((n) => n + 1);
  }
  const uid = useId();
  return <GlossaryFields key={entry ? `row-${entry.id}` : `added-${added}`} uid={uid} locales={locales} entry={entry} state={state} action={action} pending={pending} />;
}

function GlossaryFields({
  uid,
  locales,
  entry,
  state,
  action,
  pending,
}: {
  uid: string;
  locales: GlossaryLocale[];
  entry: (GlossaryRow & { id: string }) | null;
  state: ActionResult<{ id: string }> | null;
  action: (formData: FormData) => void;
  pending: boolean;
}) {
  const [mode, setMode] = useState<'keep' | 'map'>(entry?.mode ?? 'keep');
  const id = (name: string) => `${uid}-${name}`;
  return (
    <form method="post" className="a-grid-form" onSubmit={submitKeepingValues(action)} noValidate aria-label={entry ? `Sửa thuật ngữ ${entry.term}` : 'Thêm thuật ngữ'}>
      {entry ? <input type="hidden" name="id" value={entry.id} /> : null}
      <FormMessage state={state} success={entry ? 'Đã lưu.' : 'Đã thêm thuật ngữ.'} />
      <div className="a-field">
        <label htmlFor={id('term')}>Thuật ngữ</label>
        <input id={id('term')} name="term" maxLength={80} defaultValue={entry?.term} autoComplete="off" aria-describedby={id('term-error')} aria-invalid={invalidField(state, 'term')} />
        <FieldError state={state} name="term" id={id('term-error')} />
      </div>
      <div className="a-field">
        <label htmlFor={id('mode')}>Cách xử lý</label>
        <select id={id('mode')} name="mode" value={mode} onChange={(e) => setMode(e.currentTarget.value as 'keep' | 'map')}>
          <option value="keep">Giữ nguyên</option>
          <option value="map">Đổi thành…</option>
        </select>
      </div>
      <div className="a-field">
        <label htmlFor={id('locale')}>Ngôn ngữ</label>
        <select id={id('locale')} name="locale" defaultValue={entry?.locale ?? ''} aria-describedby={id('locale-error')} aria-invalid={invalidField(state, 'locale')}>
          <option value="">{mode === 'keep' ? 'Mọi ngôn ngữ' : 'Chọn ngôn ngữ'}</option>
          {locales.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
        <FieldError state={state} name="locale" id={id('locale-error')} />
      </div>
      {mode === 'map' ? (
        <div className="a-field">
          <label htmlFor={id('target')}>Đổi thành</label>
          <input id={id('target')} name="target" maxLength={80} defaultValue={entry?.target ?? ''} autoComplete="off" aria-describedby={id('target-error')} aria-invalid={invalidField(state, 'target')} />
          <FieldError state={state} name="target" id={id('target-error')} />
        </div>
      ) : null}
      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang lưu…' : entry ? 'Lưu' : 'Thêm thuật ngữ'}
      </button>
    </form>
  );
}

function DeleteGlossary({ id, term }: { id: string; term: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(deleteGlossaryAction, null);
  return (
    <form className="a-inline-form a-inline-form--button" action={action}>
      <input type="hidden" name="id" value={id} />
      <button
        className="a-btn a-btn--ghost a-btn--small"
        type="submit"
        disabled={pending}
        aria-label={`Xóa thuật ngữ ${term}`}
        onClick={(e) => {
          if (!window.confirm(`Xóa thuật ngữ “${term}”?`)) e.preventDefault();
        }}
      >
        Xóa
      </button>
      <FormMessage state={state && !state.ok ? state : null} />
    </form>
  );
}
