'use client';

import { useActionState } from 'react';
import type { ReservationStatus } from '@/lib/booking/rules';
import type { ActionResult } from '@/lib/server/action-result';
import { FieldError, FormMessage } from '../../_ui/FormMessage';
import { changeStatus } from '../actions';

export type TransitionOption = { to: ReservationStatus; label: string; reasonRequired: boolean; enabled: boolean; hint: string | null };

/*
 * One form, one button per transition the status allows; React builds the
 * FormData with the clicked button, so its name/value reaches the action.
 * The version is the one this page was drawn with: a stale one comes back
 * as "Vừa được … thay đổi". The server checks the windows and reasons again.
 */
export function TransitionPanel({ id, version, options }: { id: string; version: number; options: TransitionOption[] }) {
  const [state, action, pending] = useActionState<ActionResult<{ status: ReservationStatus }> | null, FormData>(changeStatus, null);
  if (options.length === 0) return <p className="a-muted">Đặt bàn đã kết thúc; không còn thao tác nào.</p>;
  const needsReason = options.some((o) => o.reasonRequired);
  return (
    <form className="a-transitions" action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
      <FormMessage state={state} success="Đã cập nhật trạng thái." />
      <div className="a-field">
        <label htmlFor="res-transition-reason">{needsReason ? 'Lý do (bắt buộc khi hủy hoặc từ chối)' : 'Lý do (không bắt buộc)'}</label>
        <input id="res-transition-reason" name="reason" maxLength={500} aria-describedby="res-transition-reason-error" />
        <FieldError state={state} name="reason" id="res-transition-reason-error" />
      </div>
      <div className="a-actions">
        {options.map((o) => (
          <span className="a-action" key={o.to}>
            <button
              className={`a-btn${o.to === 'cancelled' || o.to === 'declined' || o.to === 'no_show' ? ' a-btn--danger' : ''}`}
              type="submit"
              name="to"
              value={o.to}
              disabled={pending || !o.enabled}
            >
              {o.label}
            </button>
            {o.hint ? <small className="a-sub">{o.hint}</small> : null}
          </span>
        ))}
      </div>
    </form>
  );
}
