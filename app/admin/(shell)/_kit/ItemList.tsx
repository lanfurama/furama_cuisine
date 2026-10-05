'use client';

import { useActionState, useState, type ReactNode } from 'react';
import type { ActionResult } from '@/lib/server/action-result';
import { FormMessage, RuleAlert, fieldMessages } from '../_ui/FormMessage';
import { LimitNote, moved, SortableList } from './SortableList';
import { Thumb, type ThumbFile } from './Thumb';
import { useLeaveGuard } from './useLeaveGuard';

type Action = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

/** One item of a list screen, as the list shows it; its form and History come in `details`. */
export type ItemRow = {
  id: string;
  /** How the screen names the item (buttons, the announcement, the confirms). */
  name: string;
  isPublished: boolean;
  /** The item's own token: its show/hide and delete post it. */
  token: string;
  /** A second line under the name ("Địa điểm · 6 nhà hàng đang hiện"). */
  meta?: string;
  thumb?: ThumbFile | null;
  /** Said in the confirm before "Ẩn" (what hiding takes off the site); null hides without asking. */
  hideWarning?: string | null;
};

/** A list write's outcome, with the rules it broke inside the alert when it was refused (a switch or a delete has no field to mark). */
function ListMessage({ state, success }: { state: ActionResult | null; success?: string }) {
  const rules = fieldMessages(state);
  return rules.length ? <RuleAlert lead="Không lưu được thay đổi này:" rules={rules} /> : <FormMessage state={state} success={success} />;
}

/*
 * A content list in its guest order (spec §7.3 SortableList, §6.5 limits),
 * shared by the list screens of plan 7B (destinations, cuisines, experiences,
 * stories, navigation). Moving is local until "Lưu thứ tự" (one 'reorder'
 * with the whole old order in its audit row); show/hide and delete act at
 * once with the item's token; "Sửa …" opens the item's own form and History,
 * which the server page renders (`details`, by id). Code rule 9: the
 * reorder's state lives here and the order below remounts on a new list
 * token (the ids in order).
 */
export function ItemList({
  label,
  noun,
  items,
  listToken,
  limit,
  warnings,
  empty,
  reorder,
  toggle,
  remove,
  details,
}: {
  /** The list's and its order form's accessible name ("Thứ tự điểm đến"). */
  label: string;
  /** The item's kind in sentences ("điểm đến"). */
  noun: string;
  items: readonly ItemRow[];
  listToken: string;
  /** Spec §6.5's maximum shown, when the list has one that refuses. */
  limit?: number;
  warnings: readonly string[];
  empty: string;
  reorder: Action;
  toggle: Action;
  remove: Action;
  details: Record<string, ReactNode>;
}) {
  const [state, dispatch, pending] = useActionState<ActionResult | null, FormData>(reorder, null);
  const shown = items.filter((i) => i.isPublished).length;
  return (
    <>
      {limit !== undefined ? (
        <LimitNote shown={shown} max={limit} warnings={warnings} />
      ) : (
        // A list whose limit only advises (spec §6.5 "Cuisines: nên tối đa 10"): the count, and the advice past it.
        <div className="a-limit">
          <p className="a-muted">Đang hiện {shown} mục.</p>
          {warnings.length ? (
            <ul className="a-warn-list">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      <ItemOrder
        key={listToken}
        label={label}
        noun={noun}
        items={items}
        listToken={listToken}
        empty={empty}
        state={state}
        dispatch={dispatch}
        pending={pending}
        toggle={toggle}
        remove={remove}
        details={details}
      />
    </>
  );
}

function ItemOrder({
  label,
  noun,
  items,
  listToken,
  empty,
  state,
  dispatch,
  pending,
  toggle,
  remove,
  details,
}: {
  label: string;
  noun: string;
  items: readonly ItemRow[];
  listToken: string;
  empty: string;
  state: ActionResult | null;
  dispatch: (formData: FormData) => void;
  pending: boolean;
  toggle: Action;
  remove: Action;
  details: Record<string, ReactNode>;
}) {
  const [order, setOrder] = useState(() => items.map((i) => i.id));
  const byId = new Map(items.map((i) => [i.id, i]));
  const ordered = order.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const changed = order.join(',') !== items.map((i) => i.id).join(',');
  // A new order is unsaved work like a form's typing: a reload or a closed tab asks first.
  useLeaveGuard(changed);
  return (
    <>
      {ordered.length === 0 ? (
        <p className="a-muted">{empty}</p>
      ) : (
        <SortableList
          label={label}
          items={ordered}
          itemKey={(i) => i.id}
          itemLabel={(i) => i.name}
          onMove={(from, to) => setOrder(moved(order, from, to))}
          renderItem={(i) => <Row item={i} noun={noun} toggle={toggle} remove={remove} details={details[i.id]} />}
        />
      )}
      <form action={dispatch} className="a-inline-form" aria-label={label}>
        <input type="hidden" name="token" value={listToken} />
        <input type="hidden" name="order" value={JSON.stringify(order)} />
        <button type="submit" className="a-btn" disabled={!changed || pending}>
          {pending ? 'Đang lưu…' : 'Lưu thứ tự'}
        </button>
        {changed ? <span className="a-muted">Thứ tự mới chưa được lưu.</span> : null}
        <ListMessage state={state} success="Đã lưu thứ tự." />
      </form>
    </>
  );
}

function Row({ item: i, noun, toggle, remove, details }: { item: ItemRow; noun: string; toggle: Action; remove: Action; details: ReactNode }) {
  const [toggleState, toggleDispatch, toggling] = useActionState<ActionResult | null, FormData>(toggle, null);
  const [deleteState, removeDispatch, removing] = useActionState<ActionResult | null, FormData>(remove, null);
  return (
    <div>
      <div className="a-item-row">
        {i.thumb ? <Thumb file={i.thumb} width={96} className="a-picker-thumb" /> : <span className="a-muted">—</span>}
        <div>
          <p>{i.name}</p>
          <p className="a-muted">
            <span className={i.isPublished ? 'a-tag' : 'a-tag a-tag--warn'}>{i.isPublished ? 'Đang hiện' : 'Đang ẩn'}</span>
            {i.meta ? ` · ${i.meta}` : ''}
          </p>
        </div>
        <div className="a-actions">
          <form action={toggleDispatch} className="a-inline-form">
            <input type="hidden" name="id" value={i.id} />
            <input type="hidden" name="token" value={i.token} />
            <input type="hidden" name="publish" value={i.isPublished ? '0' : '1'} />
            <button
              type="submit"
              className="a-btn a-btn--ghost a-btn--small"
              disabled={toggling}
              aria-label={`${i.isPublished ? 'Ẩn' : 'Hiện'} “${i.name}”`}
              onClick={(e) => {
                if (i.isPublished && i.hideWarning && !window.confirm(`Ẩn “${i.name}”? ${i.hideWarning}`)) e.preventDefault();
              }}
            >
              {i.isPublished ? 'Ẩn' : 'Hiện'}
            </button>
          </form>
          <form action={removeDispatch} className="a-inline-form">
            <input type="hidden" name="id" value={i.id} />
            <input type="hidden" name="token" value={i.token} />
            <button
              type="submit"
              className="a-btn a-btn--danger a-btn--small"
              disabled={removing}
              aria-label={`Xóa “${i.name}”`}
              onClick={(e) => {
                if (!window.confirm(`Xóa ${noun} “${i.name}”? Khôi phục được từ "Đã xóa gần đây".`)) e.preventDefault();
              }}
            >
              Xóa
            </button>
          </form>
        </div>
      </div>
      <ListMessage state={toggleState} />
      <ListMessage state={deleteState} />
      <details>
        <summary>Sửa “{i.name}”</summary>
        {details}
      </details>
    </div>
  );
}
