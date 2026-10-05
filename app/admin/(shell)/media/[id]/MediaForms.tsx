'use client';

import Link from 'next/link';
import { useActionState, useId } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import { FieldError, FormMessage } from '../../_ui/FormMessage';
import { deleteMediaAction, saveMediaDetailsAction } from '../actions';

/*
 * EN alt text (≤ 250, spec §5.2 media_i18n) and the decorative flag (alt=""
 * wherever the file is shown). Code rule 9: the action state lives here,
 * above the fields, which remount on a new token so they start again from
 * what was saved, while "Đã lưu." stays.
 */
export function MediaDetailsForm({ id, token, alt, decorative }: { id: string; token: string; alt: string; decorative: boolean }) {
  const uid = useId();
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveMediaDetailsAction, null);
  return (
    <form method="post" className="a-grid-form" onSubmit={submitKeepingValues(action)} noValidate aria-label="Mô tả ảnh">
      <FormMessage state={state} success="Đã lưu." />
      <div key={token} className="a-field a-field--wide">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="token" value={token} />
        <label htmlFor={`${uid}-alt`}>Mô tả ảnh (tiếng Anh, cho trình đọc màn hình)</label>
        <textarea
          id={`${uid}-alt`}
          name="alt"
          rows={2}
          maxLength={250}
          defaultValue={alt}
          aria-invalid={state && !state.ok && state.fieldErrors?.alt ? true : undefined}
          aria-describedby={`${uid}-alt-error ${uid}-alt-hint`}
        />
        <p className="a-muted" id={`${uid}-alt-hint`}>
          Tối đa 250 ký tự. Một mô tả cho mọi chỗ dùng ảnh này; bản dịch làm ở đợt đa ngôn ngữ.
        </p>
        <FieldError state={state} name="alt" id={`${uid}-alt-error`} />
        <label className="a-check">
          <input type="checkbox" name="decorative" defaultChecked={decorative} /> Ảnh trang trí (không cần mô tả; trình đọc màn hình bỏ qua)
        </label>
      </div>
      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang lưu…' : 'Lưu mô tả'}
      </button>
    </form>
  );
}

/*
 * "Xóa file": refused with the list of places while the file is used (AC3;
 * the server checks again under a lock, this page's list may be stale). A
 * delete moves the file to the trash and goes back to the library.
 */
export function DeleteMediaForm({ id, token, inUse }: { id: string; token: string; inUse: boolean }) {
  // A successful delete redirects to the library (actions.ts), so only a refusal comes back here.
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(deleteMediaAction, null);
  return (
    <form method="post" className="a-inline-form" onSubmit={submitKeepingValues(action)} aria-label="Xóa file">
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
