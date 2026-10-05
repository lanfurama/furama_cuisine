'use client';

import { useActionState, useId } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import { FieldError, FormMessage } from '../../_ui/FormMessage';
import { saveInbox } from './actions';

/* site_settings.email: where staff.new goes when nobody else matches, and where a guest's reply lands. */
export function SharedInboxForm({ email, token }: { email: string; token: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveInbox, null);
  const uid = useId();
  return (
    <form method="post" className="a-grid-form" onSubmit={submitKeepingValues(action)} key={token} noValidate aria-label="Hộp thư chung">
      <input type="hidden" name="token" value={token} />
      <FormMessage state={state} success="Đã lưu." />
      <div className="a-field">
        <label htmlFor={`${uid}-email`}>Email hộp thư chung</label>
        <input id={`${uid}-email`} name="email" type="email" autoComplete="off" maxLength={254} defaultValue={email} aria-describedby={`${uid}-email-error`} />
        <FieldError state={state} name="email" id={`${uid}-email-error`} />
      </div>
      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang lưu…' : 'Lưu hộp thư chung'}
      </button>
    </form>
  );
}
