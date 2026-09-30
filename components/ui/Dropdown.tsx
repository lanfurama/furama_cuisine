'use client';

import { useSite } from '@/components/site/SiteProvider';

export type Option<T extends string | number> = {
  value: T;
  label: string;
  note?: string;
  disabled?: boolean;
};

type Props<T extends string | number> = {
  id: string;
  label: string;
  value: T;
  options: Option<T>[];
  onPick: (value: T) => void;
  /** `plain` is the open, underline-free finder style; `boxed` is the bordered drawer field. */
  variant?: 'plain' | 'boxed';
};

export function Dropdown<T extends string | number>({
  id,
  label,
  value,
  options,
  onPick,
  variant = 'plain',
}: Props<T>) {
  const { openDropdown, toggleDropdown, closeDropdown } = useSite();
  const open = openDropdown === id;
  const current = options.find((o) => o.value === value);

  return (
    <div className={`dd dd-${variant}`} data-dd="1">
      <button
        type="button"
        className="dd-trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => toggleDropdown(id)}
      >
        <span className="dd-label">{label}</span>
        <span className="dd-value">
          <span className="dd-value-text">{current ? current.label : '—'}</span>
          <span className="dd-caret" data-open={open}>
            ▾
          </span>
        </span>
      </button>

      {open && (
        <div className="dd-panel" role="listbox" aria-label={label}>
          {options.map((o) => {
            const selected = o.value === value;
            return (
              <button
                type="button"
                key={String(o.value)}
                role="option"
                aria-selected={selected}
                aria-disabled={o.disabled}
                className="dd-option"
                data-selected={selected}
                data-disabled={o.disabled}
                onClick={() => {
                  if (o.disabled) return;
                  onPick(o.value);
                  closeDropdown();
                }}
              >
                <span>{o.label}</span>
                <span className="dd-note">{o.note ?? (selected ? '●' : '')}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Flat chip list — the mobile sheet's stand-in for a dropdown. */
export function ChipGroup<T extends string | number>({
  label,
  value,
  options,
  onPick,
}: Omit<Props<T>, 'id' | 'variant'>) {
  return (
    <div className="chip-group">
      <div className="field-label">{label}</div>
      <div className="chip-row">
        {options.map((o) => (
          <button
            type="button"
            key={String(o.value)}
            className="chip"
            data-selected={o.value === value}
            data-disabled={o.disabled}
            aria-pressed={o.value === value}
            onClick={() => !o.disabled && onPick(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
