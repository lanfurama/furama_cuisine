'use client';

import { useActionState } from 'react';
import type { ActionResult } from '@/lib/server/action-result';
import { FormMessage } from '../../_ui/FormMessage';
import { deleteOfferAction } from './actions';

/* "Xóa ưu đãi" on the offer's own page. After it, the page redraws as the deleted offer with its History. */
export function DeleteOffer({ id, token, title }: { id: string; token: string; title: string }) {
  const [state, dispatch, pending] = useActionState<ActionResult<{ unlinked: number }> | null, FormData>(deleteOfferAction, null);
  return (
    <form action={dispatch} className="a-inline-form a-danger-zone" aria-label="Xóa ưu đãi">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="token" value={token} />
      <button
        type="submit"
        className="a-btn a-btn--danger"
        disabled={pending}
        onClick={(e) => {
          if (!window.confirm(`Xóa “${title}”? Đặt bàn đã chọn ưu đãi này giữ nguyên, chỉ mất liên kết. Khôi phục được từ Lịch sử.`)) e.preventDefault();
        }}
      >
        Xóa ưu đãi
      </button>
      <FormMessage state={state} />
    </form>
  );
}
