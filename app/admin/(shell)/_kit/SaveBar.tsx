'use client';

import type { ActionResult } from '@/lib/server/action-result';
import { FormMessage } from '../_ui/FormMessage';

/*
 * The foot of every editor (spec §7.3): the outcome of the last save (a
 * conflict names who saved first and when, with "Tải lại"), a notice when a
 * newer version arrived while the form held unsaved edits (useSaveState
 * `stale`), who saved the record last, "Xem trên web", and the save button.
 * "Tải lại" is the hook's reload(): a bare router.refresh() would bring a
 * record the still-dirty form never takes. The success notice hides once
 * staff type again, so "Đã lưu" never sits beside unsaved edits. It sticks to
 * the bottom of the viewport, so a long form always shows it. The form's own
 * fields come before it in the DOM, so the tab order reaches it last.
 */
export function SaveBar({
  state,
  pending,
  dirty,
  stale = false,
  onReload,
  lastSaved,
  viewHref,
  label = 'Lưu',
  success = 'Đã lưu. Trang khách cập nhật ngay.',
}: {
  state: ActionResult<unknown> | null;
  pending: boolean;
  dirty: boolean;
  /** A newer version of the record arrived while the form held unsaved edits. */
  stale?: boolean;
  /** "Tải lại": useSaveState's reload(). */
  onReload: () => void;
  lastSaved?: { by: string | null; at: string } | null;
  viewHref?: string | null;
  label?: string;
  success?: string;
}) {
  const conflict = state !== null && !state.ok && state.code === 'conflict';
  return (
    <div className="a-savebar">
      <div className="a-savebar-status">
        {state?.ok && dirty ? null : <FormMessage state={state} success={success} onReload={onReload} />}
        {stale && !conflict ? (
          <div className="a-warn">
            <p role="status">Có người vừa lưu bản mới của mục này. Lưu bây giờ sẽ báo xung đột; bấm “Tải lại” để xem bản mới (phần chưa lưu sẽ mất).</p>
            <button className="a-btn a-btn--ghost a-btn--small" type="button" onClick={onReload}>
              Tải lại
            </button>
          </div>
        ) : null}
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
