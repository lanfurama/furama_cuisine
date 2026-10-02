'use client';

import { useActionState } from 'react';
import { actionErrorMessage } from '@/lib/admin/auth-errors';
import type { ActionResult } from '@/lib/server/action-result';
import { changeStatus, type StatusChange } from './actions';

/* "Xác nhận" straight from the inbox; the version turns a stale row into a conflict, never a silent overwrite. */
export function QuickConfirm({ id, version, reference }: { id: string; version: number; reference: string }) {
  const [state, action, pending] = useActionState<ActionResult<StatusChange> | null, FormData>(changeStatus, null);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
      <button className="a-btn a-btn--small" type="submit" name="to" value="confirmed" disabled={pending} aria-label={`Xác nhận ${reference}`}>
        Xác nhận
      </button>
      {state && !state.ok ? (
        <p className="a-field-error" role="alert">
          {actionErrorMessage(state.code, state.params)}
        </p>
      ) : null}
    </form>
  );
}
