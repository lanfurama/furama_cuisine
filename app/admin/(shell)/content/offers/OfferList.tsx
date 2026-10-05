'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { LIMITS } from '@/lib/admin/content-rules';
import type { ActionResult } from '@/lib/server/action-result';
import type { OfferListItem } from '@/lib/server/content-admin/offers';
import { FormMessage } from '../../_ui/FormMessage';
import { LimitNote, moved, SortableList } from '../../_kit/SortableList';
import { deleteOfferAction, reorderOffersAction, toggleOfferAction } from './actions';

const STATE_LABELS: Record<OfferListItem['state'], string> = {
  shown: 'Đang hiện',
  hidden: 'Đang ẩn',
  upcoming: 'Chưa tới ngày',
  ended: 'Đã hết hạn',
  restaurant_hidden: 'Nhà hàng đang ẩn',
  untitled: 'Thiếu tiêu đề EN',
};

/*
 * The offers in their guest order (spec §7.3 SortableList). Moving items is
 * local until "Lưu thứ tự", which saves the whole order as one 'reorder'
 * (its audit row keeps the old order). Show/hide and delete act at once, one
 * offer each, with that offer's token. Code rule 9: the reorder's action
 * state lives here; the order below remounts on a new list token (the ids in
 * order: an add, a delete, a saved or restored reorder), while a show/hide
 * keeps a reorder that is not saved yet.
 */
export function OfferList({ items, listToken, warnings }: { items: OfferListItem[]; listToken: string; warnings: string[] }) {
  const [state, dispatch, pending] = useActionState<ActionResult | null, FormData>(reorderOffersAction, null);
  const shown = items.filter((i) => i.state === 'shown').length;
  return (
    <>
      <LimitNote shown={items.filter((i) => i.isPublished).length} max={LIMITS.offers.max} warnings={warnings} />
      <p className="a-muted">Hôm nay khách thấy {shown} ưu đãi.</p>
      <OfferOrder key={listToken} items={items} listToken={listToken} state={state} dispatch={dispatch} pending={pending} />
    </>
  );
}

function OfferOrder({
  items,
  listToken,
  state,
  dispatch,
  pending,
}: {
  items: OfferListItem[];
  listToken: string;
  state: ActionResult | null;
  dispatch: (formData: FormData) => void;
  pending: boolean;
}) {
  const [order, setOrder] = useState(() => items.map((i) => i.id));
  const byId = new Map(items.map((i) => [i.id, i]));
  const ordered = order.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const changed = order.join(',') !== items.map((i) => i.id).join(',');
  return (
    <>
      {ordered.length === 0 ? (
        <p className="a-muted">Chưa có ưu đãi nào.</p>
      ) : (
        <SortableList
          label="Thứ tự ưu đãi"
          items={ordered}
          itemKey={(o) => o.id}
          itemLabel={(o) => o.title ?? `Ưu đãi ${o.id}`}
          onMove={(from, to) => setOrder(moved(order, from, to))}
          renderItem={(o) => <OfferRow offer={o} />}
        />
      )}
      <form action={dispatch} className="a-inline-form" aria-label="Thứ tự ưu đãi">
        <input type="hidden" name="token" value={listToken} />
        <input type="hidden" name="order" value={JSON.stringify(order)} />
        <button type="submit" className="a-btn" disabled={!changed || pending}>
          {pending ? 'Đang lưu…' : 'Lưu thứ tự'}
        </button>
        {changed ? <span className="a-muted">Thứ tự mới chưa được lưu.</span> : null}
        <FormMessage state={state} success="Đã lưu thứ tự." />
      </form>
    </>
  );
}

function OfferRow({ offer: o }: { offer: OfferListItem }) {
  const name = o.title ?? `Ưu đãi ${o.id}`;
  const [toggleState, toggle, toggling] = useActionState<ActionResult | null, FormData>(toggleOfferAction, null);
  const [deleteState, remove, removing] = useActionState<ActionResult<{ unlinked: number }> | null, FormData>(deleteOfferAction, null);
  const dates = [o.validFrom && `từ ${o.validFrom}`, o.validUntil && `đến ${o.validUntil}`].filter(Boolean).join(' ');
  return (
    <div className="a-offer-row">
      <div>
        <p>
          <Link href={`/admin/content/offers/${o.id}`}>{name}</Link>
        </p>
        <p className="a-muted">
          {o.restaurant}
          {dates ? ` · ${dates}` : ''} · <span className={o.state === 'shown' ? 'a-tag' : 'a-tag a-tag--warn'}>{STATE_LABELS[o.state]}</span>
        </p>
      </div>
      <div className="a-actions">
        <form action={toggle} className="a-inline-form">
          <input type="hidden" name="id" value={o.id} />
          <input type="hidden" name="token" value={o.token} />
          <input type="hidden" name="publish" value={o.isPublished ? '0' : '1'} />
          <button type="submit" className="a-btn a-btn--ghost a-btn--small" disabled={toggling} aria-label={`${o.isPublished ? 'Ẩn' : 'Hiện'} “${name}”`}>
            {o.isPublished ? 'Ẩn' : 'Hiện'}
          </button>
        </form>
        <form action={remove} className="a-inline-form">
          <input type="hidden" name="id" value={o.id} />
          <input type="hidden" name="token" value={o.token} />
          <button
            type="submit"
            className="a-btn a-btn--danger a-btn--small"
            disabled={removing}
            aria-label={`Xóa “${name}”`}
            onClick={(e) => {
              if (!window.confirm(`Xóa “${name}”? Đặt bàn đã chọn ưu đãi này giữ nguyên, chỉ mất liên kết. Khôi phục được từ "Đã xóa gần đây".`)) e.preventDefault();
            }}
          >
            Xóa
          </button>
        </form>
      </div>
      <FormMessage state={toggleState} />
      <FormMessage state={deleteState} />
    </div>
  );
}
