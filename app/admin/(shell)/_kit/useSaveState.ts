'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useState } from 'react';
import { initialSaveState, markSaveDirty, nextSaveState, reloadSaveState, savedToken } from '@/lib/admin/save-state';
import type { ActionResult } from '@/lib/server/action-result';
import { useLeaveGuard } from './useLeaveGuard';

type Action<T> = (prev: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;

/*
 * The state holder of an editor (code rule 9, spec §7.3 SaveBar). It lives
 * above the fields, which the editor keys on `fieldsKey`, and draws from the
 * view it accepted with the token it posts.
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
 * colleague's save silently.) Text typed while this form's own save is in
 * flight stays too, when the page then holds exactly the version the save
 * wrote: its token is taken, the fields do not remount, and the form stays
 * unsaved (lib/admin/save-state.ts). The save says which version that is:
 * its data's `token` (Saved), or `written(data, posted)` for a form whose
 * token is built from several (the strings form joins one per key; `posted`
 * is the view the fields were drawn from when it was sent).
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
export function useSaveState<T, V>(action: Action<T>, token: string, view: V, written: (data: T, posted: V) => string | null = savedToken) {
  const router = useRouter();
  const [state, dispatch, pending] = useActionState<ActionResult<T> | null, FormData>(action, null);
  const [seen, setSeen] = useState(() => initialSaveState(state, token, view));
  // Adjusted during render, not in an effect, so the notice and the fields agree.
  const saved = state?.ok ? written(state.data, seen.view) : null;
  const current = nextSaveState(seen, { state, ok: state?.ok === true, saved, pending, token, view });
  if (current !== seen) setSeen(current);
  const visible = state !== null && !state.ok && current.arrivedWith !== current.token ? null : state;

  // Leaving with unsaved edits (reload, close, another site) asks first; a client-side link inside the admin does not.
  useLeaveGuard(current.dirty);

  return {
    state: visible,
    dispatch,
    pending,
    dirty: current.dirty,
    /** The record the form posts (the hidden token input). */
    token: current.token,
    /** What the fields remount on: key them on it. */
    fieldsKey: current.fieldsKey,
    view: current.view,
    /** A newer version arrived while the form held unsaved edits. */
    stale: current.token !== token,
    // Functional updates: a late callback (an upload finishing) may hold a render's closure from before a save.
    markDirty: () => setSeen(markSaveDirty),
    /** "Tải lại": drop the unsaved edits, show the record the page has, and ask the server for the newest. */
    reload: () => {
      setSeen((s) => reloadSaveState(s, token, view));
      router.refresh();
    },
  };
}
