'use client';

import { useId, useState, type ChangeEvent } from 'react';
import { checkLength, TRANSLATION_STRETCH } from '@/lib/admin/content-rules';

export type LocaleTab = { code: string; label: string };
export type TranslationStatus = 'machine' | 'reviewed' | 'stale';

/** Until phase 8 (spec §7.3, §8) the editors show English only. */
export const EN_ONLY: readonly LocaleTab[] = [{ code: 'en', label: 'EN' }];

const STATUS_LABELS: Record<TranslationStatus, string> = { machine: 'Máy dịch', reviewed: 'Đã duyệt', stale: 'EN đã đổi' };

/*
 * One translatable text (spec §7.3). The value is per language
 * (`{ en: '…', vi: '…' }`) and each language posts as `<name>.<code>`, so
 * phase 8 turns `locales` into tabs ("Dịch từ EN", the status badge) without
 * changing a form or a schema. Today `locales` is EN_ONLY and no tab shows.
 *
 * The counter compares with the column's or registry's maximum (the server
 * refuses beyond it) and with an optional warning length (spec §6.5: a menu
 * label over 14). A translation much longer than its EN (×1.3, spec §6.5
 * note) warns too. Uncontrolled with `name` (the form posts it); controlled
 * with `onChange` (inside a list that posts as one JSON field).
 */
export function TranslatableField({
  name,
  label,
  values,
  locales = EN_ONLY,
  max,
  warnAt,
  warnMessage,
  rows,
  required,
  hint,
  error,
  status,
  onChange,
}: {
  name?: string;
  label: string;
  values: Record<string, string | null | undefined>;
  locales?: readonly LocaleTab[];
  max: number;
  warnAt?: number;
  warnMessage?: string;
  /** A textarea of that many rows; omitted: one line. */
  rows?: number;
  required?: boolean;
  hint?: string;
  /** The server's message for this field (FieldError's first). */
  error?: string;
  status?: Record<string, TranslationStatus | undefined>;
  onChange?: (locale: string, value: string) => void;
}) {
  const uid = useId();
  const [active, setActive] = useState(locales[0].code);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const text = (code: string) => (onChange ? (values[code] ?? '') : (typed[code] ?? values[code] ?? ''));

  return (
    <div className="a-field a-field--wide a-tfield">
      {locales.length > 1 ? (
        <div role="tablist" aria-label={`${label}: ngôn ngữ`} className="a-tabs">
          {locales.map((l) => (
            <button
              key={l.code}
              type="button"
              role="tab"
              id={`${uid}-tab-${l.code}`}
              aria-selected={active === l.code}
              aria-controls={`${uid}-panel-${l.code}`}
              onClick={() => setActive(l.code)}
            >
              {l.label}
              {status?.[l.code] ? <span className="a-tag">{STATUS_LABELS[status[l.code]!]}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {locales.map((l) => {
        const id = `${uid}-${l.code}`;
        const value = text(l.code);
        const length = checkLength(value, max, warnAt);
        const enCount = [...text('en')].length;
        const longerThanEn = l.code !== 'en' && enCount > 0 && length.count > enCount * TRANSLATION_STRETCH;
        const counterId = `${id}-count`;
        const errorId = `${id}-error`;
        const hintId = `${id}-hint`;
        const describedBy = [hint && hintId, counterId, error && l.code === 'en' && errorId].filter(Boolean).join(' ');
        const props = {
          id,
          name: name ? `${name}.${l.code}` : undefined,
          'aria-describedby': describedBy,
          'aria-invalid': (error && l.code === 'en') || length.level === 'error' ? true : undefined,
          'aria-required': required && l.code === 'en' ? true : undefined,
          ...(onChange
            ? { value, onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(l.code, e.currentTarget.value) }
            : {
                defaultValue: values[l.code] ?? '',
                onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                  const next = e.currentTarget.value;
                  setTyped((t) => ({ ...t, [l.code]: next }));
                },
              }),
        };
        return (
          <div
            key={l.code}
            role={locales.length > 1 ? 'tabpanel' : undefined}
            id={`${uid}-panel-${l.code}`}
            aria-labelledby={locales.length > 1 ? `${uid}-tab-${l.code}` : undefined}
            hidden={active !== l.code}
          >
            <div className="a-tfield-head">
              <label htmlFor={id}>{label}</label>
              {locales.length === 1 ? <span className="a-tag">{l.label}</span> : null}
              {required && l.code === 'en' ? <span className="a-muted">bắt buộc</span> : null}
            </div>
            {rows ? <textarea rows={rows} {...props} /> : <input type="text" {...props} />}
            {hint ? (
              <p className="a-muted" id={hintId}>
                {hint}
              </p>
            ) : null}
            <p className={`a-counter a-counter--${length.level}`} id={counterId}>
              {length.count}/{max} ký tự
              {length.level === 'warn' ? ` · ${warnMessage ?? `Dài hơn ${warnAt} ký tự, có thể không vừa bố cục.`}` : null}
              {length.level === 'error' ? ` · Vượt quá ${max} ký tự: sẽ không lưu được.` : null}
              {longerThanEn ? ' · Dài hơn bản EN khá nhiều.' : null}
            </p>
            {error && l.code === 'en' ? (
              <p className="a-field-error" id={errorId}>
                {error}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
