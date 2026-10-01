'use client';

import { useActionState } from 'react';
import { actionErrorMessage } from '@/lib/admin/auth-errors';
import type { ActionResult } from '@/lib/server/action-result';
import { acceptInvitation } from './actions';

export function AcceptForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(acceptInvitation, null);
  const failed = state && !state.ok ? state : null;
  const errors = failed?.fieldErrors ?? {};

  return (
    <form action={action} noValidate>
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
        <label htmlFor="accept-name">Họ tên</label>
        <input
          id="accept-name"
          name="name"
          autoComplete="name"
          required
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? 'accept-name-error' : undefined}
        />
        {errors.name ? (
          <p className="a-field-error" id="accept-name-error">
            {errors.name[0]}
          </p>
        ) : null}
      </div>

      <div className="a-field">
        <label htmlFor="accept-password">Mật khẩu (12–128 ký tự)</label>
        <input
          id="accept-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={errors.password ? 'accept-password-error' : undefined}
        />
        {errors.password ? (
          <p className="a-field-error" id="accept-password-error">
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
