'use client';

import { useActionState, useState } from 'react';
import type { ActionResult } from '@/lib/server/action-result';
import type { RestaurantListItem } from '@/lib/server/content-admin/restaurants';
import { FormMessage } from '../_ui/FormMessage';
import { moved, SortableList } from '../_kit/SortableList';
import { reorderRestaurantsAction } from './actions';

/*
 * The catalogue's order (the home page's cards, "More at …", the booking
 * form's list): local moves until "Lưu thứ tự", which saves the whole order as
 * one 'reorder' with its History. Code rule 9: the action state lives here,
 * the order below remounts on a new list token.
 */
export function RestaurantOrder({ items, listToken }: { items: RestaurantListItem[]; listToken: string }) {
  const [state, dispatch, pending] = useActionState<ActionResult | null, FormData>(reorderRestaurantsAction, null);
  return <Order key={listToken} items={items} listToken={listToken} state={state} dispatch={dispatch} pending={pending} />;
}

function Order({
  items,
  listToken,
  state,
  dispatch,
  pending,
}: {
  items: RestaurantListItem[];
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
      <SortableList
        label="Thứ tự nhà hàng"
        items={ordered}
        itemKey={(r) => r.id}
        itemLabel={(r) => r.name}
        onMove={(from, to) => setOrder(moved(order, from, to))}
        renderItem={(r) => (
          <span>
            {r.name}
            {r.archived ? <span className="a-muted"> · đã lưu trữ</span> : !r.isPublished ? <span className="a-muted"> · đang ẩn</span> : null}
          </span>
        )}
      />
      <form action={dispatch} className="a-inline-form" aria-label="Thứ tự nhà hàng">
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
