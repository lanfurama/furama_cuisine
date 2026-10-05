'use client';

import { useId, useRef, useState } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import type { StringsSaved } from '@/lib/server/content/strings-admin';
import { SaveBar } from '../../_kit/SaveBar';
import { useSaveState } from '../../_kit/useSaveState';
import { saveScreenStrings } from '../actions';

export type StringFieldView = {
  key: string;
  value: string;
  token: string;
  overridden: boolean;
  en: string;
  label: string;
  maxLength: number;
  vars: string[];
  context: string;
};

/*
 * One screen's strings as a form, on the form kit (spec §7.3): useSaveState
 * holds the outcome above the fields, which remount on the joined tokens of
 * the screen's keys (code rule 9), so a save or "Tải lại" redraws them from
 * the database while "Đã lưu" stays, and a refused save keeps what was typed
 * (submitKeepingValues). Every field posts its loaded value and token, so the
 * server writes only what this editor changed and refuses only a real
 * conflict on that key.
 */
/** A titled group of a screen's keys, by key prefix (the emails screen: one per email). */
export type StringGroup = { title: string; prefix: string };

export function StringsForm({
  screen,
  title,
  fields,
  groups,
  children,
}: {
  screen: string;
  title: string;
  fields: StringFieldView[];
  /** Keys under a titled fieldset each; keys no group takes come first, ungrouped. */
  groups?: readonly StringGroup[];
  /** Extra controls inside the form, before the save bar. */
  children?: React.ReactNode;
}) {
  const version = fields.map((f) => f.token).join('|');
  const save = useSaveState<StringsSaved>(saveScreenStrings, version);
  const saved = save.state?.ok ? save.state.data : null;
  const success =
    saved?.changed.length === 0
      ? 'Không có gì thay đổi.'
      : `Đã lưu ${saved?.changed.length ?? 0} mục. Web khách hiện chữ mới ngay.${saved?.policyVersion ? ` Phiên bản chính sách mới: ${saved.policyVersion}.` : ''}`;

  return (
    <form method="post" className="a-grid-form a-editor" onSubmit={submitKeepingValues(save.dispatch)} onInput={save.markDirty} noValidate aria-label={title}>
      <input type="hidden" name="screen" value={screen} />
      <StringFields key={version} fields={fields} groups={groups ?? []} state={save.state} />
      {children}
      <SaveBar state={save.state as ActionResult<unknown> | null} pending={save.pending} dirty={save.dirty} success={success} label={`Lưu ${title.toLowerCase()}`} />
    </form>
  );
}

function StringFields({ fields, groups, state }: { fields: StringFieldView[]; groups: readonly StringGroup[]; state: ActionResult<StringsSaved> | null }) {
  const field = (f: StringFieldView) => <StringField key={f.key} field={f} error={state && !state.ok ? state.fieldErrors?.[`v:${f.key}`] : undefined} />;
  const grouped = (f: StringFieldView) => groups.some((g) => f.key.startsWith(g.prefix));
  return (
    <>
      {fields.filter((f) => !grouped(f)).map(field)}
      {groups.map((g) => {
        const own = fields.filter((f) => f.key.startsWith(g.prefix));
        return own.length ? (
          <fieldset key={g.prefix} className="a-strings-group">
            <legend>{g.title}</legend>
            {own.map(field)}
          </fieldset>
        ) : null;
      })}
    </>
  );
}

function StringField({ field: f, error }: { field: StringFieldView; error?: string[] }) {
  const id = useId();
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [length, setLength] = useState([...f.value].length);
  const multiline = f.maxLength > 120 || f.value.includes('\n');
  const describedBy = [`${id}-hint`, error ? `${id}-error` : null].filter(Boolean).join(' ');
  const common = {
    id,
    ref,
    name: `v:${f.key}`,
    defaultValue: f.value,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
    onInput: (e: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>) => setLength([...e.currentTarget.value].length),
  };

  return (
    <div className="a-field a-field--wide" data-key={f.key}>
      <label htmlFor={id}>{f.label}</label>
      <input type="hidden" name={`o:${f.key}`} value={f.value} />
      <input type="hidden" name={`t:${f.key}`} value={f.token} />
      {multiline ? <textarea rows={4} {...common} /> : <input type="text" autoComplete="off" {...common} />}
      <p className={`a-counter${length > f.maxLength ? ' a-counter--error' : ''}`} id={`${id}-hint`}>
        {length}/{f.maxLength} ký tự
        {f.vars.length > 0 ? ` · Giữ nguyên biến: ${f.vars.map((v) => `{${v}}`).join(', ')}` : ''}
        {f.overridden ? ' · Đã sửa so với mặc định' : ' · Đang dùng chữ mặc định'}
      </p>
      {error ? (
        <p className="a-field-error" id={`${id}-error`}>
          {error.join(' ')}
        </p>
      ) : null}
      <details>
        <summary>Ngữ cảnh và chữ mặc định</summary>
        <p lang="en">{f.context}</p>
        <p>
          Mặc định: <span lang="en">{f.en}</span>{' '}
          <button
            type="button"
            className="a-btn a-btn--ghost a-btn--small"
            onClick={() => {
              if (!ref.current) return;
              ref.current.value = f.en;
              setLength([...f.en].length);
              // A programmatic value fires no input event: tell the form it changed.
              ref.current.dispatchEvent(new Event('input', { bubbles: true }));
            }}
          >
            Khôi phục mặc định
          </button>
        </p>
      </details>
    </div>
  );
}
