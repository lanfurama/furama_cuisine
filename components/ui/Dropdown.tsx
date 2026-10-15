'use client';

import { useLayoutEffect, useRef } from 'react';
import { useSite } from '@/components/site/SiteProvider';

export type Option<T extends string | number> = {
  value: T;
  label: string;
  note?: string;
  /** Longer text for a disabled option (a closure's public reason): its tooltip and accessible description. */
  hint?: string;
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

/** What an open list keeps between itself and the screen's edge or a fixed bar, and the least of it worth showing (three options). */
const MARGIN = 8;
const FLOOR = 132;

/**
 * Where a list can be seen, and what scrolls it there. On the page: the
 * screen less its fixed bars, and the window scrolls. In an overlay (the
 * reserve drawer) the overlay covers those bars: its scrolling body shows the
 * list and scrolls. Either way what covers the scroller's edges is its scroll
 * padding (styles/layout.css: the header at the top, a phone's tab bar at the
 * foot; a drawer's own bar at its foot).
 */
function visibleBand(field: HTMLElement): { top: number; bottom: number; scroller: Element | Window } {
  const padding = (el: Element) => {
    const style = getComputedStyle(el);
    return [parseFloat(style.scrollPaddingTop) || 0, parseFloat(style.scrollPaddingBottom) || 0];
  };
  for (let el = field.parentElement; el && el !== document.body; el = el.parentElement) {
    if (getComputedStyle(el).overflowY === 'visible') continue;
    const box = el.getBoundingClientRect();
    const [top, bottom] = padding(el);
    return { top: Math.max(box.top + top, 0), bottom: Math.min(box.bottom - bottom, window.innerHeight), scroller: el };
  }
  const [top, bottom] = padding(document.documentElement);
  return { top, bottom: window.innerHeight - bottom, scroller: window };
}

/**
 * Opens a list where it can be seen (styles/dropdown.css). Below its field as
 * drawn, unless the room below is short of the list and there is more above:
 * a field near the screen's foot used to open its list off screen. When
 * neither side has room for three options (a phone on its side, the field
 * mid-screen), the field first rises to just under the header, as a phone
 * does for a text field, and the list opens below it. Lined up with the
 * field's right edge when it would run past the screen's. Never taller than
 * the room on its side, so the options scroll inside the list instead of the
 * page. The panel is reset first, so a turn of the phone places it afresh.
 */
function placePanel(trigger: HTMLElement, panel: HTMLElement) {
  delete panel.dataset.side;
  delete panel.dataset.align;
  panel.style.maxHeight = '';

  const band = visibleBand(trigger);
  let field = trigger.getBoundingClientRect();
  const box = panel.getBoundingClientRect();
  const gap = box.top - field.bottom;
  const cap = parseFloat(getComputedStyle(panel).maxHeight) || box.height;
  const need = Math.min(panel.scrollHeight, cap);
  const fit = Math.min(need, FLOOR);
  const rooms = () => [band.bottom - field.bottom - gap - MARGIN, field.top - band.top - gap - MARGIN];

  let [below, above] = rooms();
  if (below < fit && above < fit && field.top - band.top > MARGIN) {
    // At once, whatever the page's scroll-behavior: the list is measured again straight after.
    band.scroller.scrollBy({ top: field.top - band.top - MARGIN, behavior: 'instant' });
    field = trigger.getBoundingClientRect();
    [below, above] = rooms();
  }
  const up = below < need && above > below;
  const room = Math.max(up ? above : below, fit);
  if (up) panel.dataset.side = 'above';
  if (room < cap) panel.style.maxHeight = `${Math.floor(room)}px`;

  const width = document.documentElement.clientWidth;
  if (box.right > width - MARGIN && field.right - box.width >= MARGIN) panel.dataset.align = 'end';
}

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
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Placed before the first paint, and again when the phone turns while the list is open (a new width: a phone's
  // browser also resizes the window as its toolbar shrinks and grows with the scroll, which must not move the page).
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (trigger.current && panel.current) placePanel(trigger.current, panel.current);
    };
    let width = window.innerWidth;
    const turn = () => {
      if (window.innerWidth === width) return;
      width = window.innerWidth;
      place();
    };
    place();
    window.addEventListener('resize', turn);
    return () => window.removeEventListener('resize', turn);
  }, [open]);

  return (
    <div className={`dd dd-${variant}`} data-dd="1">
      <button
        ref={trigger}
        type="button"
        className="dd-trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => toggleDropdown(id)}
      >
        <span className="dd-label">{label}</span>
        <span className="dd-value">
          <span className="dd-value-text">{current ? current.label : '—'}</span>
          <span className="dd-caret" data-open={open} aria-hidden="true">
            ▾
          </span>
        </span>
      </button>

      {open && (
        <div ref={panel} className="dd-panel" role="listbox" aria-label={label}>
          {options.map((o) => {
            const selected = o.value === value;
            return (
              <button
                type="button"
                key={String(o.value)}
                role="option"
                aria-selected={selected}
                aria-disabled={o.disabled}
                title={o.hint}
                className="dd-option"
                data-selected={selected}
                data-disabled={o.disabled}
                onClick={() => {
                  if (o.disabled) return;
                  onPick(o.value);
                  closeDropdown();
                }}
              >
                <span className="dd-option-main">
                  {o.label}
                  {/* A closed day's reason in words: as a tooltip only, a phone (no hover) never showed it. Read out from `title`. */}
                  {o.disabled && o.hint && o.hint !== o.note && (
                    <span className="dd-hint" aria-hidden="true">
                      {o.hint}
                    </span>
                  )}
                </span>
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
