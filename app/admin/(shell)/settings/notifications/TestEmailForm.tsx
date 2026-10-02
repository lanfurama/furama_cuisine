'use client';

import { useActionState } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import { EMAIL_EVENTS, EMAIL_EVENT_LABELS } from '@/lib/email/events';
import type { ActionResult } from '@/lib/server/action-result';
import type { EmailDeliveryMode } from '@/lib/server/email/types';
import { FieldError, FormMessage } from '../../_ui/FormMessage';
import { sendTest } from './actions';

const SENT: Record<EmailDeliveryMode, (to: string) => string> = {
  live: (to) => `Đã gửi email thử tới ${to}. Kiểm tra hộp thư (và thư rác).`,
  redirect: (to) => `Đã gửi email thử, chuyển hướng tới hộp thư thử nghiệm ${to} (môi trường này không gửi tới địa chỉ thật).`,
  log: () => 'Môi trường này chỉ ghi log: email thử đã được ghi vào log máy chủ, không gửi đi.',
};

/* "Gửi email thử" (spec §10.4): the sample booking's email in the chosen language, through the same gate as real emails. */
export function TestEmailForm({ defaultTo, locales }: { defaultTo: string; locales: { code: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ActionResult<{ mode: EmailDeliveryMode; to: string }> | null, FormData>(sendTest, null);
  return (
    <form method="post" className="a-grid-form" onSubmit={submitKeepingValues(action)} noValidate aria-label="Gửi email thử">
      {state?.ok ? (
        <p className="a-notice a-field--wide" role="status">
          {SENT[state.data.mode](state.data.to)}
        </p>
      ) : (
        <FormMessage state={state} />
      )}
      <div className="a-field">
        <label htmlFor="notify-test-to">Gửi tới</label>
        <input id="notify-test-to" name="to" type="email" autoComplete="off" maxLength={254} defaultValue={defaultTo} aria-describedby="notify-test-to-error" />
        <FieldError state={state} name="to" id="notify-test-to-error" />
      </div>
      <div className="a-field">
        <label htmlFor="notify-test-event">Mẫu email</label>
        <select id="notify-test-event" name="event" defaultValue="staff.new">
          {EMAIL_EVENTS.map((e) => (
            <option key={e} value={e}>
              {EMAIL_EVENT_LABELS[e]}
            </option>
          ))}
        </select>
      </div>
      <div className="a-field">
        <label htmlFor="notify-test-locale">Ngôn ngữ</label>
        <select id="notify-test-locale" name="locale" defaultValue="vi">
          {locales.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang gửi…' : 'Gửi email thử'}
      </button>
    </form>
  );
}
