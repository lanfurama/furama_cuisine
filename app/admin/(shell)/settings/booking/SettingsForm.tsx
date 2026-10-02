'use client';

import { useActionState } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import type { BookingSettings } from '@/lib/server/booking/config';
import { FieldError, FormMessage } from '../../_ui/FormMessage';
import { saveSettings } from './actions';

export function SettingsForm({ settings: s }: { settings: BookingSettings }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveSettings, null);
  const err = (name: string) => `settings-booking-${name}-error`;
  return (
    <form className="a-grid-form" onSubmit={submitKeepingValues(action)} key={s.token} noValidate aria-label="Cài đặt đặt bàn">
      <input type="hidden" name="token" value={s.token} />
      <FormMessage state={state} success="Đã lưu." />
      <div className="a-field">
        <label htmlFor="settings-booking-window">Số ngày đặt trước (tính cả hôm nay)</label>
        <input id="settings-booking-window" name="windowDays" type="number" min={1} max={90} defaultValue={s.windowDays} aria-describedby={err('windowDays')} />
        <FieldError state={state} name="windowDays" id={err('windowDays')} />
      </div>
      <div className="a-field">
        <label htmlFor="settings-booking-lead">Đặt trước tối thiểu (phút)</label>
        <input id="settings-booking-lead" name="leadMinutes" type="number" min={0} max={1440} defaultValue={s.leadMinutes} aria-describedby={err('leadMinutes')} />
        <FieldError state={state} name="leadMinutes" id={err('leadMinutes')} />
      </div>
      <div className="a-field">
        <label htmlFor="settings-booking-cutoff">Ngừng nhận đặt bàn trong ngày từ (để trống: không giới hạn)</label>
        <input id="settings-booking-cutoff" name="sameDayCutoff" type="time" defaultValue={s.sameDayCutoff ?? ''} aria-describedby={err('sameDayCutoff')} />
        <FieldError state={state} name="sameDayCutoff" id={err('sameDayCutoff')} />
      </div>
      <div className="a-field">
        <label htmlFor="settings-booking-party">Số khách tối đa</label>
        <input id="settings-booking-party" name="maxParty" type="number" min={1} max={50} defaultValue={s.maxParty} aria-describedby={err('maxParty')} />
        <FieldError state={state} name="maxParty" id={err('maxParty')} />
      </div>
      <div className="a-field">
        <label htmlFor="settings-booking-pii">Giữ dữ liệu khách (tháng)</label>
        <input
          id="settings-booking-pii"
          name="piiRetentionMonths"
          type="number"
          min={1}
          max={120}
          defaultValue={s.piiRetentionMonths}
          aria-describedby={err('piiRetentionMonths')}
        />
        <FieldError state={state} name="piiRetentionMonths" id={err('piiRetentionMonths')} />
      </div>
      <label className="a-check a-field--wide">
        <input type="checkbox" name="autoConfirm" defaultChecked={s.autoConfirm} />
        Tự động xác nhận đặt bàn online
      </label>
      <label className="a-check a-field--wide">
        <input type="checkbox" name="guestAckEmail" defaultChecked={s.guestAckEmail} />
        Gửi email “đã nhận yêu cầu” cho khách (từ đợt 5)
      </label>
      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang lưu…' : 'Lưu cài đặt'}
      </button>
    </form>
  );
}
