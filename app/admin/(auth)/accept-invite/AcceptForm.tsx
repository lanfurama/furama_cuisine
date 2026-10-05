'use client';

import { useActionState, useId } from 'react';
import { actionErrorMessage } from '@/lib/admin/auth-errors';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import { acceptInvitation } from './actions';

/*
 * The invitee's name and password. A refusal (a short password, a database
 * error) keeps what was typed (submitKeepingValues; phase-3 ledger), where
 * action={action} reset both fields while the message said the input was
 * kept. Success redirects (the action), so nothing here starts over.
 */
export function AcceptForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(acceptInvitation, null);
  const failed = state && !state.ok ? state : null;
  const errors = failed?.fieldErrors ?? {};
  const uid = useId();

  return (
    <form method="post" onSubmit={submitKeepingValues(action)} noValidate>
      <input type="hidden" name="token" value={token} />
      <p className="a-lede">
        Tài khoản cho <strong>{email}</strong>
      </p>
      {failed && !failed.fieldErrors ? (
        <p className="a-alert" role="alert">
          {actionErrorMessage(failed.code)}
        </p>
      ) : null}

      <div className="a-field">
        <label htmlFor={`${uid}-name`}>Họ tên</label>
        <input
          id={`${uid}-name`}
          name="name"
          autoComplete="name"
          required
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? `${uid}-name-error` : undefined}
        />
        {errors.name ? (
          <p className="a-field-error" id={`${uid}-name-error`}>
            {errors.name[0]}
          </p>
        ) : null}
      </div>

      <div className="a-field">
        <label htmlFor={`${uid}-password`}>Mật khẩu (12–128 ký tự)</label>
        <input
          id={`${uid}-password`}
          name="password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={errors.password ? `${uid}-password-error` : undefined}
        />
        {errors.password ? (
          <p className="a-field-error" id={`${uid}-password-error`}>
            {errors.password[0]}
          </p>
        ) : null}
      </div>

      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang tạo tài khoản…' : 'Tạo tài khoản'}
      </button>
    </form>
  );
}
