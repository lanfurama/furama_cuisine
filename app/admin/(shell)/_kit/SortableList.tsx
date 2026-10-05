'use client';

import { useId, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';

/*
 * A reorderable list (spec §7.3), controlled by its parent: it draws the
 * items in the order given and reports a move as onMove(from, to). Two ways
 * to move, the same result:
 * - "Lên" / "Xuống" buttons on every item: keyboard and screen readers (WCAG
 *   2.5.7, dragging needs a single-pointer alternative), with the new
 *   position announced in a polite live region. Focus follows the moved
 *   item: React moves a list item's DOM node to reorder it, which blurs a
 *   focused button inside it, and a button disabled at either end drops
 *   focus too. So after the move the same button takes focus again, or the
 *   item's other one when this one is now disabled.
 * - drag and drop by the handle, for a mouse.
 * Show/hide and remove belong to the item (renderItem): the list editors
 * save them per item, the restaurant form with the rest of its fields.
 */
export function SortableList<T>({
  label,
  items,
  itemKey,
  itemLabel,
  onMove,
  renderItem,
}: {
  label: string;
  items: readonly T[];
  itemKey: (item: T) => string;
  /** Names the item in the buttons' labels and the announcement. */
  itemLabel: (item: T) => string;
  onMove: (from: number, to: number) => void;
  renderItem: (item: T, index: number) => ReactNode;
}) {
  const uid = useId();
  const [said, setSaid] = useState('');
  const dragging = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  // The button a keyboard move came from, to focus again once the items have moved.
  const moving = useRef<{ key: string; dir: 'up' | 'down' } | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const buttonId = (key: string, dir: 'up' | 'down') => `${uid}-${key}-${dir}`;

  // After every commit (no dependency list): the one that follows a move has the items in their new order.
  useLayoutEffect(() => {
    const last = moving.current;
    if (!last) return;
    moving.current = null;
    // Searched inside this list, not the document: a page the router keeps hidden (<Activity>) may hold another.
    const button = (dir: 'up' | 'down') => list.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(`${uid}-${last.key}-${dir}`)}`) ?? null;
    const same = button(last.dir);
    (same && !same.disabled ? same : button(last.dir === 'up' ? 'down' : 'up'))?.focus();
  });

  const move = (from: number, to: number, dir?: 'up' | 'down') => {
    if (to < 0 || to >= items.length || from === to) return;
    if (dir) moving.current = { key: itemKey(items[from]), dir };
    onMove(from, to);
    setSaid(`Đã chuyển “${itemLabel(items[from])}” tới vị trí ${to + 1} trên ${items.length}.`);
  };

  const drop = (event: DragEvent, to: number) => {
    event.preventDefault();
    if (dragging.current !== null) move(dragging.current, to);
    dragging.current = null;
    setOver(null);
  };

  return (
    <div className="a-sortable">
      <ol ref={list} className="a-sortable-list" aria-label={label}>
        {items.map((item, index) => {
          const name = itemLabel(item);
          return (
            <li key={itemKey(item)} className={`a-sortable-item${over === index ? ' a-sortable-item--over' : ''}`}>
              {/* The drop target for a mouse drag; the buttons below are the keyboard's way to move. */}
              <div
                className="a-sortable-drop"
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(index);
                }}
                onDragLeave={() => setOver((o) => (o === index ? null : o))}
                onDrop={(e) => drop(e, index)}
              >
                <div className="a-sortable-handle">
                  <span
                    className="a-sortable-grip"
                    draggable
                    aria-hidden="true"
                    title="Kéo để đổi chỗ"
                    onDragStart={(e) => {
                      dragging.current = index;
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', itemKey(item));
                    }}
                    onDragEnd={() => {
                      dragging.current = null;
                      setOver(null);
                    }}
                  >
                    ⋮⋮
                  </span>
                  <span className="a-sortable-pos">{index + 1}</span>
                  <button
                    type="button"
                    id={buttonId(itemKey(item), 'up')}
                    className="a-btn a-btn--ghost a-btn--small"
                    aria-label={`Chuyển “${name}” lên`}
                    disabled={index === 0}
                    onClick={() => move(index, index - 1, 'up')}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    id={buttonId(itemKey(item), 'down')}
                    className="a-btn a-btn--ghost a-btn--small"
                    aria-label={`Chuyển “${name}” xuống`}
                    disabled={index === items.length - 1}
                    onClick={() => move(index, index + 1, 'down')}
                  >
                    ↓
                  </button>
                </div>
                <div className="a-sortable-body">{renderItem(item, index)}</div>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="a-visually-hidden" role="status" aria-live="polite" id={`${uid}-said`}>
        {said}
      </p>
    </div>
  );
}

/** The array with one item moved: what an onMove handler stores. */
export function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * The count line under a list (spec §6.5): how many are shown against the
 * limit, and the layout's warnings. Server-computed messages come in as
 * `warnings`; the count updates as staff toggle items before saving.
 */
export function LimitNote({ shown, max, warnings }: { shown: number; max: number; warnings: readonly string[] }) {
  return (
    <div className="a-limit">
      <p className={shown > max ? 'a-field-error' : 'a-muted'}>
        Đang hiện {shown}/{max} mục.
      </p>
      {warnings.length ? (
        <ul className="a-warn-list">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
