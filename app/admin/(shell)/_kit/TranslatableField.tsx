'use client';

import { useId, useState, type ChangeEvent } from 'react';
import { checkLength, TRANSLATION_STRETCH } from '@/lib/admin/content-rules';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';
import type { TranslationState } from '@/lib/i18n/source-hash';

export type LocaleTab = { code: string; label: string };
export type TranslationStatus = TranslationState;

/** A form whose page gives no languages: English alone, no tabs. */
export const EN_ONLY: readonly LocaleTab[] = [{ code: DEFAULT_LOCALE, label: 'EN' }];

const STATUS_LABELS: Record<TranslationStatus, string> = { missing: 'Chưa dịch', machine: 'Máy dịch', reviewed: 'Đã duyệt', stale: 'EN đã đổi' };

/*
 * One translatable text (spec §7.3). The value is per language
 * (`{ en: '…', vi: '…' }`) and each language posts as `<name>.<code>`. With
 * more than one language (lib/server/content-admin/form-locales.ts) each is a
 * tab with its state (Chưa dịch, Máy dịch, Đã duyệt, EN đã đổi); a translation
 * left empty means "use English", and a tab that needs work shows the English
 * text under its field. "Dịch từ EN" arrives with phase 9 (R8-13).
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
              {status?.[l.code] && l.code !== DEFAULT_LOCALE ? (
                <span className={status[l.code] === 'reviewed' ? 'a-tag' : 'a-tag a-tag--warn'}>{STATUS_LABELS[status[l.code]!]}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
      {locales.map((l) => {
        const id = `${uid}-${l.code}`;
        const value = text(l.code);
        const length = checkLength(value, max, warnAt);
        const english = text(DEFAULT_LOCALE);
        const enCount = [...english].length;
        const longerThanEn = l.code !== DEFAULT_LOCALE && enCount > 0 && length.count > enCount * TRANSLATION_STRETCH;
        const needsWork = l.code !== DEFAULT_LOCALE && (status?.[l.code] === 'stale' || status?.[l.code] === 'missing' || status?.[l.code] === 'machine');
        const counterId = `${id}-count`;
        const errorId = `${id}-error`;
        const hintId = `${id}-hint`;
        const describedBy = [hint && hintId, counterId, error && l.code === DEFAULT_LOCALE && errorId].filter(Boolean).join(' ');
        const props = {
          id,
          name: name ? `${name}.${l.code}` : undefined,
          'aria-describedby': describedBy,
          'aria-invalid': (error && l.code === DEFAULT_LOCALE) || length.level === 'error' ? true : undefined,
          'aria-required': required && l.code === DEFAULT_LOCALE ? true : undefined,
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
              {required && l.code === DEFAULT_LOCALE ? <span className="a-muted">bắt buộc</span> : null}
            </div>
            {rows ? <textarea rows={rows} {...props} /> : <input type="text" {...props} />}
            {hint ? (
              <p className="a-muted" id={hintId}>
                {hint}
              </p>
            ) : null}
            {needsWork && english ? <p className="a-muted">Bản tiếng Anh: {english}</p> : null}
            {l.code !== DEFAULT_LOCALE && locales.length > 1 && !value ? <p className="a-muted">Để trống: khách thấy bản tiếng Anh.</p> : null}
            <p className={`a-counter a-counter--${length.level}`} id={counterId}>
              {length.count}/{max} ký tự
              {length.level === 'warn' ? ` · ${warnMessage ?? `Dài hơn ${warnAt} ký tự, có thể không vừa bố cục.`}` : null}
              {length.level === 'error' ? ` · Vượt quá ${max} ký tự: sẽ không lưu được.` : null}
              {longerThanEn ? ' · Dài hơn bản EN khá nhiều.' : null}
            </p>
            {error && l.code === DEFAULT_LOCALE ? (
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
