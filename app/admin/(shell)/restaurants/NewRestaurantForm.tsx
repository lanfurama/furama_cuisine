'use client';

import { useActionState, useId } from 'react';
import { LENGTHS } from '@/lib/admin/content-rules';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import { FieldError, FormMessage } from '../_ui/FormMessage';
import { createRestaurantAction } from './actions';

/*
 * "Thêm nhà hàng" (R22): a name, the slug that becomes its id for good, and
 * its destination. The new restaurant is a hidden draft, online booking off;
 * the action opens its content screen.
 */
export function NewRestaurantForm({ destinations }: { destinations: { id: string; name: string }[] }) {
  const [state, dispatch, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(createRestaurantAction, null);
  const uid = useId();
  return (
    <form method="post" className="a-grid-form" onSubmit={submitKeepingValues(dispatch)} noValidate aria-label="Thêm nhà hàng">
      <FormMessage state={state} />
      <div className="a-field">
        <label htmlFor={`${uid}-name`}>Tên nhà hàng</label>
        <input id={`${uid}-name`} name="name" maxLength={LENGTHS.restaurantName.max} aria-describedby={`${uid}-name-error`} />
        <FieldError state={state} name="name" id={`${uid}-name-error`} />
      </div>
      <div className="a-field">
        <label htmlFor={`${uid}-slug`}>Đường dẫn (slug)</label>
        <input id={`${uid}-slug`} name="slug" maxLength={60} aria-describedby={`${uid}-slug-hint ${uid}-slug-error`} />
        <p className="a-muted" id={`${uid}-slug-hint`}>
          Chữ thường không dấu, số và gạch nối. Là mã của nhà hàng từ nay về sau.
        </p>
        <FieldError state={state} name="slug" id={`${uid}-slug-error`} />
      </div>
      <div className="a-field">
        <label htmlFor={`${uid}-dest`}>Điểm đến</label>
        <select id={`${uid}-dest`} name="destinationId" aria-describedby={`${uid}-dest-error`}>
          {destinations.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <FieldError state={state} name="destinationId" id={`${uid}-dest-error`} />
      </div>
      <div className="a-field--wide">
        <button type="submit" className="a-btn" disabled={pending}>
          {pending ? 'Đang tạo…' : 'Thêm nhà hàng'}
        </button>
        <p className="a-muted">Nhà hàng mới ở trạng thái ẩn, chưa nhận đặt bàn online. Hiện nó khi đã có ảnh thẻ và loại nhà hàng.</p>
      </div>
    </form>
  );
}
