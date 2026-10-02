'use client';

import { useActionState, useState } from 'react';
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
 *
 * Guest email (spec §10.3, R8): confirming and declining always email a guest
 * who gave an address; a cancel does when "Báo khách qua email khi hủy" stays
 * ticked (on by default). The reason field says when its text will reach the
 * guest: staff often type it in Vietnamese for an English email.
 */
export function TransitionPanel({ id, version, options }: { id: string; version: number; options: TransitionOption[] }) {
  const [state, action, pending] = useActionState<ActionResult<{ status: ReservationStatus }> | null, FormData>(changeStatus, null);
  // The box is uncontrolled (the action's form reset ticks it again); its state follows it back to on with each result.
  const [notifyAt, setNotifyAt] = useState<{ state: typeof state; on: boolean }>({ state, on: true });
  const notify = notifyAt.state === state ? notifyAt.on : true;
  if (options.length === 0) return <p className="a-muted">Đặt bàn đã kết thúc; không còn thao tác nào.</p>;
  const needsReason = options.some((o) => o.reasonRequired);
  const canCancel = options.some((o) => o.to === 'cancelled');
  const canDecline = options.some((o) => o.to === 'declined');
  const reasonHint =
    canCancel && notify ? 'Lý do này sẽ được gửi cho khách.' : canDecline ? 'Lý do từ chối sẽ được gửi cho khách.' : null;
  return (
    <form className="a-transitions" action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
      <FormMessage state={state} success="Đã cập nhật trạng thái." />
      <div className="a-field">
        <label htmlFor="res-transition-reason">{needsReason ? 'Lý do (bắt buộc khi hủy hoặc từ chối)' : 'Lý do (không bắt buộc)'}</label>
        <input
          id="res-transition-reason"
          name="reason"
          maxLength={500}
          aria-describedby={reasonHint ? 'res-transition-reason-hint res-transition-reason-error' : 'res-transition-reason-error'}
        />
        {reasonHint ? (
          <small className="a-sub" id="res-transition-reason-hint">
            {reasonHint}
          </small>
        ) : null}
        <FieldError state={state} name="reason" id="res-transition-reason-error" />
      </div>
      {canCancel ? (
        <label className="a-check">
          <input type="checkbox" name="notifyGuest" defaultChecked onChange={(e) => setNotifyAt({ state, on: e.target.checked })} />
          Báo khách qua email khi hủy
        </label>
      ) : null}
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
