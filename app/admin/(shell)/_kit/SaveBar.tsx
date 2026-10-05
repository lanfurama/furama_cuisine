'use client';

import type { ActionResult } from '@/lib/server/action-result';
import { FormMessage } from '../_ui/FormMessage';

/*
 * The foot of every editor (spec §7.3): the outcome of the last save (a
 * conflict names who saved first and when, with "Tải lại"), who saved the
 * record last, "Xem trên web", and the save button. It sticks to the bottom
 * of the viewport, so a long form always shows it. The form's own fields come
 * before it in the DOM, so the tab order reaches it last.
 */
export function SaveBar({
  state,
  pending,
  dirty,
  lastSaved,
  viewHref,
  label = 'Lưu',
  success = 'Đã lưu. Trang khách cập nhật ngay.',
}: {
  state: ActionResult<unknown> | null;
  pending: boolean;
  dirty: boolean;
  lastSaved?: { by: string | null; at: string } | null;
  viewHref?: string | null;
  label?: string;
  success?: string;
}) {
  return (
    <div className="a-savebar">
      <div className="a-savebar-status">
        <FormMessage state={state} success={success} />
        {dirty ? <p className="a-muted">Có thay đổi chưa lưu.</p> : null}
        {lastSaved && !dirty ? (
          <p className="a-muted">
            Sửa lần cuối{lastSaved.by ? ` bởi ${lastSaved.by}` : ''} lúc {lastSaved.at}
          </p>
        ) : null}
      </div>
      <div className="a-actions">
        {viewHref ? (
          <a className="a-btn a-btn--ghost" href={viewHref} target="_blank" rel="noopener">
            Xem trên web
          </a>
        ) : null}
        <button className="a-btn" type="submit" disabled={pending}>
          {pending ? 'Đang lưu…' : label}
        </button>
      </div>
    </div>
  );
}
