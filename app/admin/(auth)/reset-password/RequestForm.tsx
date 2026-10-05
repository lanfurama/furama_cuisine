'use client';

import { useActionState, useId } from 'react';
import { requestPasswordReset, type RequestResetState } from './actions';

export function RequestForm() {
  const [state, action, pending] = useActionState<RequestResetState, FormData>(requestPasswordReset, null);
  const errors = state?.fieldErrors ?? {};
  const uid = useId();

  if (state?.sent) {
    return (
      <p className="a-lede" role="status">
        Nếu email này có tài khoản, chúng tôi đã gửi liên kết đặt lại mật khẩu. Liên kết có hiệu lực trong 60 phút.
      </p>
    );
  }
  return (
    <form action={action} noValidate>
      <p className="a-lede">Nhập email đăng nhập. Chúng tôi sẽ gửi liên kết để đặt mật khẩu mới.</p>
      {state?.message ? (
        <p className="a-alert" role="alert">
          {state.message}
        </p>
      ) : null}
      <div className="a-field">
        <label htmlFor={`${uid}-email`}>Email</label>
        <input
          id={`${uid}-email`}
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={state?.email ?? ''}
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? `${uid}-email-error` : undefined}
        />
        {errors.email ? (
          <p className="a-field-error" id={`${uid}-email-error`}>
            {errors.email[0]}
          </p>
        ) : null}
      </div>
      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang gửi…' : 'Gửi liên kết'}
      </button>
    </form>
  );
}
