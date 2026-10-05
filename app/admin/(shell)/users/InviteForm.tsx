'use client';

import { useActionState, useId, useState } from 'react';
import { inviteOutcome } from '@/lib/admin/auth-errors';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import type { InviteDelivery } from '@/lib/server/auth/staff';
import { FieldError, invalidField } from '../_ui/FormMessage';
import { inviteStaff } from './actions';

/*
 * "Mời nhân viên". A refused invite (already staff, already invited, a bad
 * address) keeps the email and role typed (submitKeepingValues; phase-3
 * ledger: action={action} reset them while the message said they were
 * kept). An invite that went through starts the fields over: they are keyed
 * on the invites made here, counted during render when the result arrives.
 * The line above the fields is inviteOutcome's (a "created but not sent"
 * invite is an alert, with why).
 */
export function InviteForm() {
  const [state, action, pending] = useActionState<ActionResult<InviteDelivery> | null, FormData>(inviteStaff, null);
  const [sent, setSent] = useState({ state, count: 0 });
  if (sent.state !== state) setSent({ state, count: sent.count + (state?.ok ? 1 : 0) });
  const uid = useId();
  const outcome = inviteOutcome(state);

  return (
    <form className="a-inline-form" method="post" onSubmit={submitKeepingValues(action)} noValidate aria-labelledby={`${uid}-title`}>
      <h2 id={`${uid}-title`}>Mời nhân viên</h2>
      {outcome ? (
        <p className={outcome.role === 'status' ? 'a-notice' : 'a-alert'} role={outcome.role}>
          {outcome.text}
        </p>
      ) : null}
      <div key={sent.count}>
        <div className="a-field">
          <label htmlFor={`${uid}-email`}>Email</label>
          <input
            id={`${uid}-email`}
            name="email"
            type="email"
            required
            aria-invalid={invalidField(state, 'email')}
            aria-describedby={`${uid}-email-error`}
          />
          <FieldError state={state} name="email" id={`${uid}-email-error`} />
        </div>
        <div className="a-field">
          <label htmlFor={`${uid}-role`}>Vai trò</label>
          <select id={`${uid}-role`} name="role" defaultValue="editor">
            <option value="editor">Editor</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      </div>
      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang gửi…' : 'Gửi lời mời'}
      </button>
    </form>
  );
}
