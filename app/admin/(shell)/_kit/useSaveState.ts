'use client';

import { useActionState, useEffect, useState } from 'react';
import type { ActionResult } from '@/lib/server/action-result';

type Action<T> = (prev: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;

/*
 * The state holder of an editor (code rule 9, spec §7.3 SaveBar). It lives
 * above the fields, which the page keys on the record's token: a save here,
 * or "Tải lại" after someone else's, brings a new token and redraws the
 * fields from the record as it now is, while this hook (and so the "Đã lưu"
 * notice) stays. A refused save keeps the token, so nothing remounts and what
 * staff typed stays (submitKeepingValues).
 *
 * A failure is shown only for the token it came with: after "Tải lại" the
 * fields hold the newer record, and a "Vừa được … sửa" above them would be
 * stale (phase-4 ledger, QuickConfirm). `dirty` drives the leave-page guard.
 */
export function useSaveState<T>(action: Action<T>, token: string) {
  const [state, dispatch, pending] = useActionState<ActionResult<T> | null, FormData>(action, null);
  // arrivedWith: the token the page had when this result came back.
  const [seen, setSeen] = useState({ state, arrivedWith: token, token, dirty: false });
  let current = seen;
  // A new result, or a new token: adjusted during render, not in an effect, so the notice and the fields agree.
  if (seen.state !== state) current = { state, arrivedWith: token, token, dirty: state?.ok ? false : seen.dirty };
  else if (seen.token !== token) current = { ...seen, token, dirty: false };
  if (current !== seen) setSeen(current);
  const visible = state !== null && !state.ok && current.arrivedWith !== token ? null : state;

  useEffect(() => {
    if (!current.dirty) return;
    // Leaving with unsaved edits (reload, close, another site) asks first; a client-side link inside the admin does not.
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [current.dirty]);

  return {
    state: visible,
    dispatch,
    pending,
    dirty: current.dirty,
    markDirty: () => {
      if (!current.dirty) setSeen({ ...current, dirty: true });
    },
  };
}
