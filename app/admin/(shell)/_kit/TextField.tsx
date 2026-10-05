'use client';

import { useId, useState } from 'react';
import { checkLength } from '@/lib/admin/content-rules';

/*
 * A plain (not translated) text field with the kit's counter and error
 * wiring: a restaurant's name (spec §6.5: over 24 warns), slug, phone, links.
 * Uncontrolled: the form posts `name`.
 */
export function TextField({
  name,
  label,
  defaultValue,
  max,
  warnAt,
  warnMessage,
  hint,
  error,
  required,
  type = 'text',
  wide,
}: {
  name: string;
  label: string;
  defaultValue: string | null;
  max: number;
  warnAt?: number;
  warnMessage?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  type?: 'text' | 'url' | 'tel';
  wide?: boolean;
}) {
  const id = useId();
  const [value, setValue] = useState(defaultValue ?? '');
  const length = checkLength(value, max, warnAt);
  const describedBy = [hint && `${id}-hint`, `${id}-count`, error && `${id}-error`].filter(Boolean).join(' ');
  return (
    <div className={`a-field${wide ? ' a-field--wide' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue ?? ''}
        onChange={(e) => setValue(e.currentTarget.value)}
        aria-describedby={describedBy}
        aria-invalid={error || length.level === 'error' ? true : undefined}
        aria-required={required || undefined}
      />
      {hint ? (
        <p className="a-muted" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      <p className={`a-counter a-counter--${length.level}`} id={`${id}-count`}>
        {length.count}/{max} ký tự
        {length.level === 'warn' ? ` · ${warnMessage ?? `Dài hơn ${warnAt} ký tự.`}` : null}
        {length.level === 'error' ? ` · Vượt quá ${max} ký tự: sẽ không lưu được.` : null}
      </p>
      {error ? (
        <p className="a-field-error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
