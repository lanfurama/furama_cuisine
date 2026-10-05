import { describe, expect, it } from 'vitest';
import { initialSaveState, markSaveDirty, nextSaveState, reloadSaveState, type SaveSeen } from './save-state';

type R = { ok: boolean } | null;
type V = { label: string };
const OK: R = { ok: true };
const REFUSED: R = { ok: false };

/** One render after another, as useSaveState runs them; `saved` is the token a successful save says it wrote. */
function render(seen: SaveSeen<R, V>, now: { state: R; saved?: string; pending?: boolean; token: string; view: V }) {
  let s = seen;
  for (;;) {
    const next = nextSaveState(s, {
      state: now.state,
      ok: now.state?.ok === true,
      saved: now.saved ?? null,
      pending: now.pending ?? false,
      token: now.token,
      view: now.view,
    });
    if (next === s) return s;
    s = next;
  }
}

describe('an editor’s save state (useSaveState)', () => {
  const start = initialSaveState<R, V>(null, 't1', { label: 'Thai' });

  it('a save with nothing typed meanwhile takes the saved record and remounts the fields on it', () => {
    let s = markSaveDirty(start);
    s = render(s, { state: null, pending: true, token: 't1', view: { label: 'Thai' } });
    s = render(s, { state: OK, token: 't2', view: { label: 'Thai & Lao' } });
    expect(s).toMatchObject({ token: 't2', fieldsKey: 't2', view: { label: 'Thai & Lao' }, dirty: false });
  });

  it('text typed while the save is in flight stays: the new record is taken, the fields do not remount, the form stays unsaved (7A review A2)', () => {
    let s = markSaveDirty(start);
    s = render(s, { state: null, pending: true, token: 't1', view: { label: 'Thai' } });
    s = markSaveDirty(s);
    s = render(s, { state: OK, saved: 't2', token: 't2', view: { label: 'Thai & Lao' } });
    expect(s).toMatchObject({ token: 't2', fieldsKey: 't1', view: { label: 'Thai & Lao' }, dirty: true });
    // The next save starts clean of that, and its own success remounts as usual.
    s = render(s, { state: OK, pending: true, token: 't2', view: { label: 'Thai & Lao' } });
    const next: R = { ok: true };
    s = render(s, { state: next, token: 't3', view: { label: 'Thai, Lao' } });
    expect(s).toMatchObject({ token: 't3', fieldsKey: 't3', dirty: false });
  });

  it('…only on the version that save wrote: a colleague’s save that landed in between remounts the fields on it (never posted under typed text)', () => {
    let s = markSaveDirty(start);
    s = render(s, { state: null, pending: true, token: 't1', view: { label: 'Thai' } });
    s = markSaveDirty(s);
    // The save wrote t2; the page, read after it, already holds a colleague's t3.
    s = render(s, { state: OK, saved: 't2', token: 't3', view: { label: 'Thai (Minh)' } });
    expect(s).toMatchObject({ token: 't3', fieldsKey: 't3', view: { label: 'Thai (Minh)' }, dirty: false });
  });

  it('a save that does not say what it wrote (a create, on the list’s token) remounts the fields: a second “Thêm” never adds the row again', () => {
    let s = markSaveDirty(initialSaveState<R, V>(null, 'list1', { label: '' }));
    s = render(s, { state: null, pending: true, token: 'list1', view: { label: '' } });
    s = markSaveDirty(s);
    s = render(s, { state: OK, token: 'list2', view: { label: '' } });
    expect(s).toMatchObject({ token: 'list2', fieldsKey: 'list2', dirty: false, editedWhileSaving: false });
  });

  it('a refused save keeps the fields and the token; a newer record waits while the form is unsaved', () => {
    let s = markSaveDirty(start);
    s = render(s, { state: REFUSED, token: 't1', view: { label: 'Thai' } });
    expect(s).toMatchObject({ token: 't1', fieldsKey: 't1', dirty: true, arrivedWith: 't1' });
    s = render(s, { state: REFUSED, token: 't9', view: { label: 'Other' } });
    expect(s).toMatchObject({ token: 't1', fieldsKey: 't1', view: { label: 'Thai' } });
  });

  it('a clean form follows a newer record', () => {
    expect(render(start, { state: null, token: 't9', view: { label: 'Other' } })).toMatchObject({ token: 't9', fieldsKey: 't9', view: { label: 'Other' } });
  });

  it('"Tải lại" remounts the fields on the page’s record even when its token is the same, and clears the unsaved mark (7A fix-wave residual)', () => {
    const typed = markSaveDirty(start);
    const reloaded = reloadSaveState(typed, 't1', { label: 'Thai' });
    expect(reloaded).toMatchObject({ token: 't1', dirty: false });
    expect(reloaded.fieldsKey).not.toBe(typed.fieldsKey);
    expect(reloadSaveState(reloaded, 't1', { label: 'Thai' }).fieldsKey).not.toBe(reloaded.fieldsKey);
  });
});
