'use client';

import { useActionState } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import { FormMessage } from '../../../_ui/FormMessage';
import { saveAutoConfirmSetting } from './auto-confirm-actions';

/* Admin only: the page renders it only for a role with reservations:auto-confirm, and the action checks again. */
export function AutoConfirmForm({ restaurantId, token, value, defaultValue }: { restaurantId: string; token: string; value: boolean | null; defaultValue: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveAutoConfirmSetting, null);
  return (
    // submitKeepingValues: a refused save (a conflict) keeps the Admin's pick, where action={action} would reset
    // the select. key: a save moves the token and the select takes the saved value; the hook state above stays.
    <form className="a-inline-form" method="post" onSubmit={submitKeepingValues(action)} key={token} aria-label="Tự động xác nhận">
      <input type="hidden" name="restaurant" value={restaurantId} />
      <input type="hidden" name="token" value={token} />
      <FormMessage state={state} success="Đã lưu." />
      <div className="a-field">
        <label htmlFor="booking-auto-confirm">Tự động xác nhận đặt bàn online (chỉ Admin)</label>
        <select id="booking-auto-confirm" name="autoConfirm" defaultValue={value === null ? 'inherit' : value ? 'on' : 'off'}>
          <option value="inherit">{`Theo cài đặt chung (${defaultValue ? 'bật' : 'tắt'})`}</option>
          <option value="on">Bật</option>
          <option value="off">Tắt</option>
        </select>
      </div>
      <button className="a-btn a-btn--ghost" type="submit" disabled={pending}>
        Lưu
      </button>
    </form>
  );
}
