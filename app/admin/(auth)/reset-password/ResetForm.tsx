'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { ADMIN_SIGN_IN } from '@/lib/admin/paths';
import { resetPassword, type ResetState } from './actions';

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(resetPassword, null);
  const errors = state?.fieldErrors ?? {};

  if (state?.done) {
    return (
      <>
        <p className="a-lede" role="status">
          Đã đổi mật khẩu. Hãy đăng nhập bằng mật khẩu mới.
        </p>
        <Link className="a-btn" href={ADMIN_SIGN_IN}>
          Đăng nhập
        </Link>
      </>
    );
  }
  return (
    <form action={action} noValidate>
      <input type="hidden" name="token" value={token} />
      {state?.message ? (
        <p className="a-alert" role="alert">
          {state.message}
        </p>
      ) : null}
      <div className="a-field">
        <label htmlFor="reset-password">Mật khẩu mới (12–128 ký tự)</label>
        <input
          id="reset-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={errors.password ? 'reset-password-error' : undefined}
        />
        {errors.password ? (
          <p className="a-field-error" id="reset-password-error">
            {errors.password[0]}
          </p>
        ) : null}
      </div>
      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang lưu…' : 'Đặt mật khẩu'}
      </button>
    </form>
  );
}
