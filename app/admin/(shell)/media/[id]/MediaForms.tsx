'use client';

import Link from 'next/link';
import { useActionState, useId } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import type { Saved } from '@/lib/admin/save-state';
import type { ActionResult } from '@/lib/server/action-result';
import { SaveBar } from '../../_kit/SaveBar';
import { useSaveState } from '../../_kit/useSaveState';
import { FieldError, FormMessage, invalidField } from '../../_ui/FormMessage';
import { deleteMediaAction, saveMediaDetailsAction } from '../actions';

/*
 * EN alt text (≤ 250, spec §5.2 media_i18n) and the decorative flag (alt=""
 * wherever the file is shown), on the editors' save state and SaveBar (7A
 * review UX-10): the fields remount on the token useSaveState accepted, a
 * newer version while typing is a "Tải lại" notice, unsaved edits guard the
 * page, and the bar says who saved last.
 */
export function MediaDetailsForm({
  id,
  token,
  alt,
  decorative,
  lastSaved,
}: {
  id: string;
  token: string;
  alt: string;
  decorative: boolean;
  lastSaved: { by: string | null; at: string } | null;
}) {
  const save = useSaveState<Saved, { alt: string; decorative: boolean }>(saveMediaDetailsAction, token, { alt, decorative });
  return (
    <form method="post" className="a-grid-form" onSubmit={submitKeepingValues(save.dispatch)} onInput={save.markDirty} noValidate aria-label="Mô tả ảnh">
      <DetailsFields key={save.fieldsKey} id={id} token={save.token} values={save.view} state={save.state} />
      <SaveBar state={save.state} pending={save.pending} dirty={save.dirty} stale={save.stale} onReload={save.reload} lastSaved={lastSaved} label="Lưu mô tả" />
    </form>
  );
}

function DetailsFields({
  id,
  token,
  values,
  state,
}: {
  id: string;
  token: string;
  values: { alt: string; decorative: boolean };
  state: ActionResult<unknown> | null;
}) {
  const uid = useId();
  return (
    <div className="a-field a-field--wide">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="token" value={token} />
      <label htmlFor={`${uid}-alt`}>Mô tả ảnh (tiếng Anh, cho trình đọc màn hình)</label>
      <textarea
        id={`${uid}-alt`}
        name="alt"
        rows={2}
        maxLength={250}
        defaultValue={values.alt}
        aria-invalid={invalidField(state, 'alt')}
        aria-describedby={`${uid}-alt-error ${uid}-alt-hint`}
      />
      <p className="a-muted" id={`${uid}-alt-hint`}>
        Tối đa 250 ký tự. Một mô tả cho mọi chỗ dùng ảnh này; bản dịch làm ở đợt đa ngôn ngữ.
      </p>
      <FieldError state={state} name="alt" id={`${uid}-alt-error`} />
      <label className="a-check">
        <input type="checkbox" name="decorative" defaultChecked={values.decorative} /> Ảnh trang trí (không cần mô tả; trình đọc màn hình bỏ qua)
      </label>
    </div>
  );
}

/*
 * "Xóa file", after a confirm: refused with the list of places while the
 * file is used (AC3; the server checks again under a lock, this page's list
 * may be stale). A delete moves the file to the trash and goes back to the
 * library.
 */
export function DeleteMediaForm({ id, token, inUse, name }: { id: string; token: string; inUse: boolean; name: string }) {
  // A successful delete redirects to the library (actions.ts), so only a refusal comes back here.
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(deleteMediaAction, null);
  const submit = submitKeepingValues(action);
  return (
    // Asks first, like every other delete (UX-10): it goes to the trash, and History brings it back.
    <form
      method="post"
      className="a-inline-form"
      onSubmit={(event) => {
        if (!window.confirm(`Xóa file “${name}”? File vào thùng rác 30 ngày; khôi phục được từ Lịch sử của nó.`)) {
          event.preventDefault();
          return;
        }
        submit(event);
      }}
      aria-label="Xóa file"
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="token" value={token} />
      <FormMessage state={state} />
      {state && !state.ok && state.code === 'in_use' && state.uses ? (
        <ul className="a-list" aria-label="Nơi đang dùng file">
          {state.uses.map((u) => (
            <li key={`${u.href}|${u.label}`} className="a-list-item">
              <Link href={u.href}>{u.label}</Link>
            </li>
          ))}
        </ul>
      ) : null}
      {inUse ? <p className="a-muted">File đang được dùng: thay ảnh ở các chỗ trên trước khi xóa.</p> : null}
      <button className="a-btn a-btn--danger" type="submit" disabled={pending}>
        {pending ? 'Đang xóa…' : 'Xóa file'}
      </button>
    </form>
  );
}
