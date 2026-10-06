'use client';

import { useActionState, useId, useState } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import { FormMessage, fieldMessages } from '../_ui/FormMessage';
import { addLanguage, saveLinkLanguages } from './actions';

type Action = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

/** A refusal's own sentences (the rule that refused), under the generic message. */
function Refusal({ state }: { state: ActionResult | null }) {
  const messages = fieldMessages(state);
  return messages.length ? (
    <ul className="a-warn-list" role="alert">
      {messages.map((m) => (
        <li key={m}>{m}</li>
      ))}
    </ul>
  ) : null;
}

/**
 * One write on one language, as a one-button form: its hidden fields, and the
 * table's token so a second Admin's change is refused, not overwritten.
 */
export function LocaleButton({
  action,
  fields,
  label,
  confirm,
  danger,
}: {
  action: Action;
  fields: Record<string, string>;
  label: string;
  /** Asked before posting (a delete). */
  confirm?: string;
  danger?: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action, null);
  return (
    <form
      method="post"
      className="a-inline-form"
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) {
          e.preventDefault();
          return;
        }
        submitKeepingValues(formAction)(e);
      }}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" className={`a-btn ${danger ? 'a-btn--danger' : 'a-btn--ghost'} a-btn--small`} disabled={pending}>
        {label}
      </button>
      <FormMessage state={state} />
      <Refusal state={state} />
    </form>
  );
}

/** "Thêm ngôn ngữ": the catalogue's languages not in the table yet (spec §8 step 1). */
export function AddLanguageForm({ options, token }: { options: { code: string; label: string }[]; token: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(addLanguage, null);
  const id = useId();
  if (options.length === 0) return <p className="a-muted">Đã thêm mọi ngôn ngữ trong danh sách.</p>;
  return (
    <form method="post" className="a-grid-form" onSubmit={submitKeepingValues(formAction)} aria-label="Thêm ngôn ngữ">
      <input type="hidden" name="token" value={token} />
      <FormMessage state={state} success="Đã thêm ngôn ngữ (đang tắt). Dịch nội dung, xem trước rồi bật." />
      <div className="a-field">
        <label htmlFor={`${id}-code`}>Ngôn ngữ</label>
        <select id={`${id}-code`} name="code" defaultValue={options[0].code}>
          {options.map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <Refusal state={state} />
      <div className="a-actions">
        <button type="submit" className="a-btn" disabled={pending}>
          Thêm ngôn ngữ
        </button>
      </div>
    </form>
  );
}

/** Which languages one social link shows in (R39): every one, or the ticked ones. */
export function LinkLanguagesForm({
  link,
  languages,
}: {
  link: { id: string; name: string; token: string; visibleLocales: string[] | null };
  languages: { code: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(saveLinkLanguages, null);
  const [scope, setScope] = useState<'all' | 'some'>(link.visibleLocales ? 'some' : 'all');
  const id = useId();
  return (
    <form
      key={link.token}
      method="post"
      className="a-grid-form"
      onSubmit={submitKeepingValues(formAction)}
      aria-label={`Ngôn ngữ hiện link ${link.name}`}
    >
      <input type="hidden" name="id" value={link.id} />
      <input type="hidden" name="token" value={link.token} />
      <FormMessage state={state} success="Đã lưu." />
      <fieldset className="a-field a-field--wide">
        <legend>{link.name}</legend>
        <label className="a-check">
          <input type="radio" name="scope" value="all" checked={scope === 'all'} onChange={() => setScope('all')} /> Mọi ngôn ngữ
        </label>
        <label className="a-check">
          <input type="radio" name="scope" value="some" checked={scope === 'some'} onChange={() => setScope('some')} /> Chỉ các ngôn ngữ chọn dưới đây
        </label>
        {scope === 'some'
          ? languages.map((l) => (
              <label className="a-check" key={l.code} htmlFor={`${id}-${l.code}`}>
                <input id={`${id}-${l.code}`} type="checkbox" name="locales" value={l.code} defaultChecked={link.visibleLocales?.includes(l.code)} /> {l.label}
              </label>
            ))
          : null}
      </fieldset>
      <Refusal state={state} />
      <div className="a-actions">
        <button type="submit" className="a-btn a-btn--ghost a-btn--small" disabled={pending}>
          Lưu
        </button>
      </div>
    </form>
  );
}
