'use client';

import { useActionState } from 'react';
import { actionErrorMessage, inviteEmailFailedMessage } from '@/lib/admin/auth-errors';
import type { ActionResult } from '@/lib/server/action-result';
import type { InviteDelivery } from '@/lib/server/auth/staff';
import { inviteStaff } from './actions';

export function InviteForm() {
  const [state, action, pending] = useActionState<ActionResult<InviteDelivery> | null, FormData>(inviteStaff, null);
  const failed = state && !state.ok ? state : null;
  const errors = failed?.fieldErrors ?? {};

  return (
    <form className="a-inline-form" action={action} noValidate aria-labelledby="invite-title">
      <h2 id="invite-title">Mời nhân viên</h2>
      {state?.ok && state.data.emailSent ? (
        <p className="a-notice" role="status">
          Đã gửi lời mời.
        </p>
      ) : null}
      {/* Created but not emailed: a warning, saying why, never the green "sent" notice. */}
      {state?.ok && !state.data.emailSent ? (
        <p className="a-alert" role="alert">
          {`Đã tạo lời mời. ${inviteEmailFailedMessage(state.data.emailError)}`}
        </p>
      ) : null}
      {failed && !failed.fieldErrors ? (
        <p className="a-alert" role="alert">
          {actionErrorMessage(failed.code)}
        </p>
      ) : null}
      <div className="a-field">
        <label htmlFor="invite-email">Email</label>
        <input
          id="invite-email"
          name="email"
          type="email"
          required
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? 'invite-email-error' : undefined}
        />
        {errors.email ? (
          <p className="a-field-error" id="invite-email-error">
            {errors.email[0]}
          </p>
        ) : null}
      </div>
      <div className="a-field">
        <label htmlFor="invite-role">Vai trò</label>
        <select id="invite-role" name="role" defaultValue="editor">
          <option value="editor">Editor</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang gửi…' : 'Gửi lời mời'}
      </button>
    </form>
  );
}
