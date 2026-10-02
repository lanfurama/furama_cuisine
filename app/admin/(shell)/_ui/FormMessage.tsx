'use client';

import { useRouter } from 'next/navigation';
import { actionErrorMessage } from '@/lib/admin/auth-errors';
import type { ActionResult } from '@/lib/server/action-result';

/*
 * The outcome of a form's last submit: the error, with a reload button when
 * someone else changed the record first (spec §12 "Hai người sửa cùng lúc"),
 * or a short success notice. A failure always shows its general line,
 * `invalid` included, so a field error is never silent, even for a field the
 * form does not show; the field messages render next to their fields.
 */
export function FormMessage({ state, success }: { state: ActionResult<unknown> | null; success?: string }) {
  const router = useRouter();
  if (!state) return null;
  if (state.ok) {
    return success ? (
      <p className="a-notice" role="status">
        {success}
      </p>
    ) : null;
  }
  return (
    <div className="a-alert" role="alert">
      {actionErrorMessage(state.code, state.params)}
      {state.code === 'conflict' || state.code === 'not_allowed' ? (
        <button className="a-btn a-btn--ghost a-btn--small" type="button" onClick={() => router.refresh()}>
          Tải lại
        </button>
      ) : null}
    </div>
  );
}

/** The first error of one field, linked to its input by `id` (aria-describedby). */
export function FieldError({ state, name, id }: { state: ActionResult<unknown> | null; name: string; id: string }) {
  const message = state && !state.ok ? state.fieldErrors?.[name]?.[0] : undefined;
  return message ? (
    <p className="a-field-error" id={id}>
      {message}
    </p>
  ) : null;
}
