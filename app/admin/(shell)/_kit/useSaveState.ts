'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import type { ActionResult } from '@/lib/server/action-result';

type Action<T> = (prev: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;

/*
 * The state holder of an editor (code rule 9, spec §7.3 SaveBar). It lives
 * above the fields, which the editor keys on the token this hook accepted,
 * and draws from the view it accepted with it.
 *
 * The page's props bring the record as it is now, after any refresh: this
 * form's own save, but also a picker's upload, another form's action on the
 * page, or a History restore. The accepted { token, view } follows them only
 * when the incoming token is the accepted one, when the form is clean, when
 * this form's own save succeeds, or after reload() ("Tải lại"). While staff
 * have unsaved edits a newer record never replaces the fields: they keep
 * what was typed, `stale` says a newer version exists, and the form still
 * posts the accepted token, so saving over it is an honest conflict. (Keying
 * the fields on the old token while posting the new one would overwrite a
 * colleague's save silently.)
 *
 * `view` is the record's values only: choice lists (pictures, PDFs,
 * cuisines…) come from live props, so a fresh upload is a choice at once.
 *
 * A failure is shown only while the form holds the token it came with: once
 * it accepts a newer record, a "Vừa được … sửa" above it would be stale
 * (phase-4 ledger, QuickConfirm). A refused save keeps the token, so nothing
 * remounts and what staff typed stays (submitKeepingValues). `dirty` drives
 * the leave-page guard.
 */
export function useSaveState<T, V>(action: Action<T>, token: string, view: V) {
  const router = useRouter();
  const [state, dispatch, pending] = useActionState<ActionResult<T> | null, FormData>(action, null);
  // arrivedWith: the accepted token when this result came back.
  const [seen, setSeen] = useState({ state, arrivedWith: token, token, view, dirty: false });
  let current = seen;
  // Adjusted during render, not in an effect, so the notice and the fields agree.
  if (seen.state !== state) {
    // This form's own result: a success takes the record as the page now has it; a failure keeps the fields as typed.
    current = state?.ok ? { state, arrivedWith: token, token, view, dirty: false } : { ...seen, state, arrivedWith: seen.token };
  } else if (seen.token !== token && !seen.dirty) {
    current = { ...seen, token, view };
  }
  if (current !== seen) setSeen(current);
  const visible = state !== null && !state.ok && current.arrivedWith !== current.token ? null : state;

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
    /** The record the fields show and post: key them on it. */
    token: current.token,
    view: current.view,
    /** A newer version arrived while the form held unsaved edits. */
    stale: current.token !== token,
    // Functional updates: a late callback (an upload finishing) may hold a render's closure from before a save.
    markDirty: () => setSeen((s) => (s.dirty ? s : { ...s, dirty: true })),
    /** "Tải lại": drop the unsaved edits, take the record the page has, and ask the server for the newest. */
    reload: () => {
      setSeen((s) => ({ ...s, dirty: false }));
      router.refresh();
    },
  };
}
