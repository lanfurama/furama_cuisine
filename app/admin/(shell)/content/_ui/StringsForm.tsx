'use client';

import { useId, useRef, useState } from 'react';
import { checkLength, TRANSLATION_STRETCH } from '@/lib/admin/content-rules';
import { submitKeepingValues } from '@/lib/admin/form';
import { toBcp47 } from '@/lib/i18n/locales';
import type { TranslationState } from '@/lib/i18n/source-hash';
import type { ActionResult } from '@/lib/server/action-result';
import type { StringsSaved, StringsWritten } from '@/lib/server/content/strings-admin';
import { SaveBar } from '../../_kit/SaveBar';
import { STATUS_LABELS } from '../../_kit/TranslatableField';
import { useSaveState } from '../../_kit/useSaveState';
import { saveScreenStrings } from '../actions';

export type StringFieldView = {
  key: string;
  value: string;
  token: string;
  overridden: boolean;
  /** The registry's English default ("Khôi phục mặc định" in English). */
  en: string;
  /** The English text guests read now: a translation's placeholder and length reference. */
  english: string;
  state: TranslationState;
  label: string;
  maxLength: number;
  vars: string[];
  context: string;
};

/*
 * One screen's strings as a form, on the form kit (spec §7.3): useSaveState
 * holds the outcome above the fields, which remount on the joined tokens of
 * the screen's keys it accepted (code rule 9), so a save or "Tải lại" redraws
 * them from the database while "Đã lưu" stays, and a refused save keeps what
 * was typed (submitKeepingValues). A History restore of one key while another
 * holds unsaved typing keeps the typing (the form shows it is behind). Every
 * field posts the value and token it was drawn with, so the server writes
 * only what this editor changed (the restored key, untouched here, is left
 * alone) and refuses only a real conflict on a typed key.
 *
 * The email screen's preview controls (preview_*) sit inside this form but
 * are not text: changing them marks nothing unsaved.
 *
 * The form's token joins its keys' tokens; a save names the version it wrote
 * as the keys it sent with the written ones' new tokens, so text typed while
 * it was in flight stays only when no other key changed meanwhile either.
 */
/** A titled group of a screen's keys, by key prefix (the emails screen: one per email). */
export type StringGroup = { title: string; prefix: string };

export function StringsForm({
  screen,
  title,
  fields,
  groups,
  locale,
  localeName,
  isDefault,
  children,
}: {
  screen: string;
  title: string;
  fields: StringFieldView[];
  /** The language this form edits (the screen's ?lang=), its own name, and whether it is the default one. */
  locale: string;
  localeName: string;
  isDefault: boolean;
  /** Keys under a titled fieldset each; keys no group takes come first, ungrouped. */
  groups?: readonly StringGroup[];
  /**
   * Extra controls inside the form, after the save bar: the save button stays
   * the form's first submit button, so Enter in a field saves (the emails
   * screen's "Xem trước" is a submit button too; 7A review).
   */
  children?: React.ReactNode;
}) {
  const save = useSaveState<StringsWritten, StringFieldView[]>(saveScreenStrings, versionOf(fields), fields, (saved, posted) =>
    versionOf(posted, saved.tokens),
  );
  const saved = save.state?.ok ? save.state.data : null;
  const success =
    saved?.changed.length === 0
      ? 'Không có gì thay đổi.'
      : `Đã lưu ${saved?.changed.length ?? 0} mục. Web khách hiện chữ mới ngay.${saved?.policyVersion ? ` Phiên bản chính sách mới: ${saved.policyVersion}.` : ''}`;

  return (
    <form
      method="post"
      className="a-grid-form a-editor"
      onSubmit={submitKeepingValues(save.dispatch)}
      onInput={(e) => {
        if (!(e.target as HTMLInputElement).name?.startsWith('preview_')) save.markDirty();
      }}
      noValidate
      aria-label={title}
    >
      <input type="hidden" name="screen" value={screen} />
      <input type="hidden" name="locale" value={locale} />
      <p className="a-muted">
        Đang sửa: <strong>{localeName}</strong>
        {isDefault ? '' : '. Ô để trống: khách thấy bản tiếng Anh.'}
      </p>
      <StringFields key={save.fieldsKey} fields={save.view} groups={groups ?? []} state={save.state} lang={isDefault ? null : locale} />
      <SaveBar
        state={save.state as ActionResult<unknown> | null}
        pending={save.pending}
        dirty={save.dirty}
        stale={save.stale}
        onReload={save.reload}
        success={success}
        label={`Lưu ${title.toLowerCase()}`}
      />
      {children}
    </form>
  );
}

/** The screen's version: each key's token, in the form's order (`written`: the new tokens of the keys a save wrote). */
function versionOf(fields: readonly StringFieldView[], written: Partial<Record<string, string>> = {}): string {
  return fields.map((f) => written[f.key] ?? f.token).join('|');
}

function StringFields({
  fields,
  groups,
  state,
  lang,
}: {
  fields: StringFieldView[];
  groups: readonly StringGroup[];
  state: ActionResult<StringsSaved> | null;
  /** A translation's language; null for the default one. */
  lang: string | null;
}) {
  const field = (f: StringFieldView) => (
    <StringField key={f.key} field={f} lang={lang} error={state && !state.ok ? state.fieldErrors?.[`v:${f.key}`] : undefined} />
  );
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

function StringField({ field: f, lang, error }: { field: StringFieldView; lang: string | null; error?: string[] }) {
  const id = useId();
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [value, setValue] = useState(f.value);
  // A translation warns past 1.3 times the English length (spec §7.3), and is refused past the maximum.
  const length = checkLength(value, f.maxLength, lang ? Math.floor([...f.english].length * TRANSLATION_STRETCH) : undefined);
  const multiline = f.maxLength > 120 || f.value.includes('\n') || f.english.includes('\n');
  const describedBy = [`${id}-hint`, error ? `${id}-error` : null].filter(Boolean).join(' ');
  const common = {
    id,
    ref,
    name: `v:${f.key}`,
    defaultValue: f.value,
    lang: lang ? toBcp47(lang) : undefined,
    placeholder: lang ? f.english : undefined,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
    onInput: (e: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>) => setValue(e.currentTarget.value),
  };

  return (
    <div className="a-field a-field--wide" data-key={f.key}>
      <label htmlFor={id}>
        {f.label}
        {lang ? (
          <>
            {' '}
            <span className={f.state === 'reviewed' ? 'a-tag' : 'a-tag a-tag--warn'}>{STATUS_LABELS[f.state]}</span>
          </>
        ) : null}
      </label>
      <input type="hidden" name={`o:${f.key}`} value={f.value} />
      <input type="hidden" name={`t:${f.key}`} value={f.token} />
      {multiline ? <textarea rows={4} {...common} /> : <input type="text" autoComplete="off" {...common} />}
      <p className={`a-counter${length.level === 'error' ? ' a-counter--error' : length.level === 'warn' ? ' a-counter--warn' : ''}`} id={`${id}-hint`}>
        {length.count}/{f.maxLength} ký tự
        {length.level === 'warn' ? ' · Dài hơn nhiều so với bản tiếng Anh' : ''}
        {f.vars.length > 0 ? ` · Giữ nguyên biến: ${f.vars.map((v) => `{${v}}`).join(', ')}` : ''}
        {lang ? '' : f.overridden ? ' · Đã sửa so với mặc định' : ' · Đang dùng chữ mặc định'}
      </p>
      {lang && f.state !== 'missing' ? (
        <p className="a-muted">
          Bản tiếng Anh: <span lang="en">{f.english}</span>
        </p>
      ) : null}
      {error ? (
        <p className="a-field-error" id={`${id}-error`}>
          {error.join(' ')}
        </p>
      ) : null}
      <details>
        <summary>{lang ? 'Ngữ cảnh' : 'Ngữ cảnh và chữ mặc định'}</summary>
        <p lang="en">{f.context}</p>
        {lang ? null : (
          <p>
            Mặc định: <span lang="en">{f.en}</span>{' '}
            <button
              type="button"
              className="a-btn a-btn--ghost a-btn--small"
              onClick={() => {
                if (!ref.current) return;
                ref.current.value = f.en;
                setValue(f.en);
                // A programmatic value fires no input event: tell the form it changed.
                ref.current.dispatchEvent(new Event('input', { bubbles: true }));
              }}
            >
              Khôi phục mặc định
            </button>
          </p>
        )}
      </details>
    </div>
  );
}
