'use client';

import { useActionState } from 'react';
import { signIn, type SignInState } from './actions';

export function SignInForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, null);
  const errors = state?.fieldErrors ?? {};

  return (
    <form action={action} noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {state?.message ? (
        <p className="a-alert" role="alert">
          {state.message}
        </p>
      ) : null}

      <div className="a-field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={state?.email ?? ''}
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? 'email-error' : undefined}
        />
        {errors.email ? (
          <p className="a-field-error" id="email-error">
            {errors.email[0]}
          </p>
        ) : null}
      </div>

      <div className="a-field">
        <label htmlFor="password">Mật khẩu</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={errors.password ? 'password-error' : undefined}
        />
        {errors.password ? (
          <p className="a-field-error" id="password-error">
            {errors.password[0]}
          </p>
        ) : null}
      </div>

      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang đăng nhập…' : 'Đăng nhập'}
      </button>
    </form>
  );
}
