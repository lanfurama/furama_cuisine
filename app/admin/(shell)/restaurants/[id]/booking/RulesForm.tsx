'use client';

import { useActionState } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import { FieldError, FormMessage } from '../../../_ui/FormMessage';
import { saveRules } from './actions';

type Rules = { id: string; token: string; bookingEnabled: boolean; windowDays: number | null; leadMinutes: number | null; maxParty: number | null };
type Defaults = { windowDays: number; leadMinutes: number; maxParty: number };

/* The booking switch and the overrides; a blank override follows "Cài đặt đặt bàn". */
export function RulesForm({ restaurant: r, defaults }: { restaurant: Rules; defaults: Defaults }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveRules, null);
  const err = (name: string) => `booking-rules-${name}-error`;
  return (
    // key: a save (here or in the periods editor) moves the token; the inputs take the saved values, the hook state stays.
    <form className="a-grid-form" method="post" onSubmit={submitKeepingValues(action)} key={r.token} noValidate aria-label="Quy tắc đặt bàn">
      <input type="hidden" name="restaurant" value={r.id} />
      <input type="hidden" name="token" value={r.token} />
      <FormMessage state={state} success="Đã lưu." />
      <label className="a-check a-field--wide">
        <input type="checkbox" name="bookingEnabled" defaultChecked={r.bookingEnabled} />
        Nhận đặt bàn online (tắt thì ẩn nút RESERVE và bỏ nhà hàng khỏi form đặt bàn của khách)
      </label>
      <div className="a-field">
        <label htmlFor="booking-rules-window">Số ngày đặt trước</label>
        <input
          id="booking-rules-window"
          name="windowDays"
          type="number"
          min={1}
          max={90}
          defaultValue={r.windowDays ?? ''}
          placeholder={`${defaults.windowDays} (mặc định)`}
          aria-describedby={err('windowDays')}
        />
        <FieldError state={state} name="windowDays" id={err('windowDays')} />
      </div>
      <div className="a-field">
        <label htmlFor="booking-rules-lead">Đặt trước tối thiểu (phút)</label>
        <input
          id="booking-rules-lead"
          name="leadMinutes"
          type="number"
          min={0}
          max={1440}
          defaultValue={r.leadMinutes ?? ''}
          placeholder={`${defaults.leadMinutes} (mặc định)`}
          aria-describedby={err('leadMinutes')}
        />
        <FieldError state={state} name="leadMinutes" id={err('leadMinutes')} />
      </div>
      <div className="a-field">
        <label htmlFor="booking-rules-party">Số khách tối đa</label>
        <input
          id="booking-rules-party"
          name="maxParty"
          type="number"
          min={1}
          max={50}
          defaultValue={r.maxParty ?? ''}
          placeholder={`${defaults.maxParty} (mặc định)`}
          aria-describedby={err('maxParty')}
        />
        <FieldError state={state} name="maxParty" id={err('maxParty')} />
      </div>
      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang lưu…' : 'Lưu quy tắc'}
      </button>
    </form>
  );
}
