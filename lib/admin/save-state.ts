/*
 * The state machine of an editor's save (spec §7.3), pure so it is tested
 * without a browser; app/admin/(shell)/_kit/useSaveState.ts runs it during
 * render. It holds the record the fields show (`view`) and post (`token`),
 * and the key the fields remount on (`fieldsKey`), which is the accepted
 * token except in two cases the 7A review found:
 * - text typed while a save is in flight (A2): when the page then holds
 *   exactly the version this save wrote (the token the save answers, Saved),
 *   the save's own success takes that record (token and view, so every
 *   hidden token input the fields draw from it posts the new one, and the
 *   next save is no conflict with itself), but the fields do not remount:
 *   uncontrolled inputs keep what was typed since, and the form stays
 *   unsaved. Any other record (a colleague's save landed in between, or the
 *   save does not say what it wrote: a create) remounts the fields on it, as
 *   a save with nothing typed does: posting its token under fields that do
 *   not show it would overwrite that other save silently;
 * - "Tải lại" (the not_allowed residual of the 7A fix wave): it remounts
 *   the fields on the page's record even when the refresh brings the same
 *   token, so typed text never stays on screen without its "unsaved" mark.
 */

/** What a save behind an editor's form answers: the token of the version it wrote. */
export type Saved = { token: string };

/** The token a save's data names (Saved), else null. */
export function savedToken(data: unknown): string | null {
  return data !== null && typeof data === 'object' && typeof (data as Partial<Saved>).token === 'string' ? (data as Saved).token : null;
}

export type SaveSeen<S, V> = {
  /** The action state this step last saw. */
  state: S | null;
  /** The accepted token when that state came back: a failure shows only while it still is. */
  arrivedWith: string;
  /** The record the form posts. */
  token: string;
  /** The record the fields draw from when they mount. */
  view: V;
  /** The fields' key. */
  fieldsKey: string;
  dirty: boolean;
  /** A save is in flight, and whether the form was edited since it started. */
  saving: boolean;
  editedWhileSaving: boolean;
  reloads: number;
};

export function initialSaveState<S, V>(state: S | null, token: string, view: V): SaveSeen<S, V> {
  return { state, arrivedWith: token, token, view, fieldsKey: token, dirty: false, saving: false, editedWhileSaving: false, reloads: 0 };
}

/**
 * One render: the action's state (and whether it is a success), the token
 * that success says it wrote (null when it says none), whether a save is
 * pending, and the page's record now.
 */
export function nextSaveState<S, V>(
  seen: SaveSeen<S, V>,
  now: { state: S | null; ok: boolean; saved: string | null; pending: boolean; token: string; view: V },
): SaveSeen<S, V> {
  let next = seen;
  if (now.pending && !seen.saving) next = { ...next, saving: true, editedWhileSaving: false };
  if (seen.state !== now.state) {
    if (!now.ok) return { ...next, state: now.state, arrivedWith: next.token, saving: false };
    // This form's own save: the record as the page now has it. The fields keep what was typed meanwhile only on
    // the very version this save wrote; on any other they remount, so a colleague's save is shown, never overwritten.
    return next.editedWhileSaving && now.saved !== null && now.saved === now.token
      ? { ...next, state: now.state, arrivedWith: now.token, token: now.token, view: now.view, dirty: true, saving: false, editedWhileSaving: false }
      : { ...initialSaveState(now.state, now.token, now.view), reloads: next.reloads };
  }
  if (!now.pending && next.saving) next = { ...next, saving: false };
  // A newer record (an upload, another form on the page, a colleague) replaces a clean form only.
  if (next.token !== now.token && !next.dirty) next = { ...next, token: now.token, view: now.view, fieldsKey: now.token };
  return next;
}

/** An edit: unsaved from now, and remembered when it lands during a save. */
export function markSaveDirty<S, V>(seen: SaveSeen<S, V>): SaveSeen<S, V> {
  if (seen.dirty && (!seen.saving || seen.editedWhileSaving)) return seen;
  return { ...seen, dirty: true, editedWhileSaving: seen.editedWhileSaving || seen.saving };
}

/** "Tải lại": drop the unsaved edits and remount the fields on the record the page has, even if its token is the same. */
export function reloadSaveState<S, V>(seen: SaveSeen<S, V>, token: string, view: V): SaveSeen<S, V> {
  return { ...seen, token, view, dirty: false, editedWhileSaving: false, fieldsKey: `${token}#${seen.reloads + 1}`, reloads: seen.reloads + 1 };
}
