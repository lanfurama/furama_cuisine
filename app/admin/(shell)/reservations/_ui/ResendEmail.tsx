'use client';

import { useActionState } from 'react';
import { actionErrorMessage } from '@/lib/admin/auth-errors';
import type { ActionResult } from '@/lib/server/action-result';
import { resendEmail } from '../emails/actions';

/*
 * "Gửi lại" for one failed or waiting email. The send runs after the
 * response, so the notice says it is on its way; the row shows the outcome on
 * the next load.
 */
export function ResendEmail({ id, label }: { id: string; label: string }) {
  const [state, action, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(resendEmail, null);
  return (
    <form className="a-resend" action={action}>
      <input type="hidden" name="id" value={id} />
      <button className="a-btn a-btn--small a-btn--ghost" type="submit" disabled={pending} aria-label={`Gửi lại ${label}`}>
        {pending ? 'Đang gửi lại…' : 'Gửi lại'}
      </button>
      {state?.ok ? (
        <p className="a-sub" role="status">
          Đã đưa vào hàng gửi. Tải lại trang sau vài giây để xem kết quả.
        </p>
      ) : null}
      {state && !state.ok ? (
        <p className="a-field-error" role="alert">
          {actionErrorMessage(state.code, state.params)}
        </p>
      ) : null}
    </form>
  );
}
