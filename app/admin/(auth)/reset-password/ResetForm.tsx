'use client';

import Link from 'next/link';
import { useActionState, useId } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import { ADMIN_SIGN_IN } from '@/lib/admin/paths';
import { resetPassword, type ResetState } from './actions';

/*
 * The new password, from the emailed link. A link that is used, expired or
 * wrong says so with the way out: a link to ask for a new one (phase-3
 * ledger), the request form at this same page without its token. A refused
 * password keeps what was typed (submitKeepingValues).
 */
export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(resetPassword, null);
  const errors = state?.fieldErrors ?? {};
  const uid = useId();

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
    <form method="post" onSubmit={submitKeepingValues(action)} noValidate>
      <input type="hidden" name="token" value={token} />
      {state?.message ? (
        <div className="a-alert" role="alert">
          <p>{state.message}</p>
          {state.invalidToken ? <Link href="/admin/reset-password">Gửi lại liên kết đặt lại mật khẩu</Link> : null}
        </div>
      ) : null}
      <div className="a-field">
        <label htmlFor={`${uid}-password`}>Mật khẩu mới (12–128 ký tự)</label>
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
        {pending ? 'Đang lưu…' : 'Đặt mật khẩu'}
      </button>
    </form>
  );
}
