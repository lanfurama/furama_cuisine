'use client';

import { useActionState, useState } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import { FormMessage } from '../_ui/FormMessage';
import { changeStatus, type StatusChange } from './actions';

/*
 * "Xác nhận" straight from the inbox; the version turns a stale row into a
 * conflict, never a silent overwrite. A conflict offers "Tải lại" like every
 * other form (FormMessage), and a refusal shows only while the row still has
 * the version it came back for: once a refresh brings the row as it is now
 * (still requested, a newer version), "Vừa được … thay đổi" would be stale
 * (phase-4 ledger T9).
 */
export function QuickConfirm({ id, version, reference }: { id: string; version: number; reference: string }) {
  const [state, action, pending] = useActionState<ActionResult<StatusChange> | null, FormData>(changeStatus, null);
  const [seen, setSeen] = useState({ state, version });
  if (seen.state !== state) setSeen({ state, version });
  const refusal = state && !state.ok && seen.version === version ? state : null;
  return (
    <form method="post" onSubmit={submitKeepingValues(action)}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
      <button className="a-btn a-btn--small" type="submit" name="to" value="confirmed" disabled={pending} aria-label={`Xác nhận ${reference}`}>
        Xác nhận
      </button>
      <FormMessage state={refusal} />
    </form>
  );
}
