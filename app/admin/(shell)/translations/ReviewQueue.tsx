'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { toBcp47 } from '@/lib/i18n/locales';
import type { ActionResult } from '@/lib/server/action-result';
import type { QueueItem } from '@/lib/server/content-admin/translations';
import { FormMessage } from '../_ui/FormMessage';
import { reviewQueueItems } from './actions';

/*
 * The review queue (spec §8 "Hàng chờ duyệt"): one row per translation that
 * needs a person, with the English it follows and what it says now. A row's
 * own button reviews that row ("Duyệt" a machine translation, "Vẫn đúng" an
 * "EN đã đổi" one); the ticked rows go together through "Duyệt các mục đã
 * chọn". "Sửa" opens the item's form. The server redraws the queue after.
 */

const value = (i: QueueItem) => `${i.kind}|${i.id}|${i.locale}|${i.token}`;

export function ReviewQueue({ items, canReview }: { items: readonly QueueItem[]; canReview: boolean }) {
  const [state, dispatch, pending] = useActionState<ActionResult | null, FormData>(reviewQueueItems, null);
  if (items.length === 0) return <p className="a-muted">Không có bản dịch nào chờ duyệt.</p>;
  return (
    <form action={dispatch} aria-label="Hàng chờ duyệt">
      <FormMessage state={state} success="Đã duyệt." />
      <table className="a-table a-review-queue">
        <thead>
          <tr>
            {canReview ? <th scope="col">Chọn</th> : null}
            <th scope="col">Mục</th>
            <th scope="col">Ngôn ngữ</th>
            <th scope="col">Bản tiếng Anh</th>
            <th scope="col">Bản dịch</th>
            <th scope="col">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => {
            const name = `${i.kindLabel} ${i.id} (${i.locale.toUpperCase()})`;
            return (
              <tr key={value(i)}>
                {canReview ? (
                  <td>{i.reviewable ? <input type="checkbox" name="item" value={value(i)} aria-label={`Chọn ${name}`} /> : null}</td>
                ) : null}
                <th scope="row">
                  {i.kindLabel}
                  <span className="a-muted"> · {i.id}</span>{' '}
                  <span className="a-tag a-tag--warn">{i.reason === 'machine' ? 'Máy dịch' : 'EN đã đổi'}</span>
                </th>
                <td>{i.locale.toUpperCase()}</td>
                <td lang="en">{i.english}</td>
                <td lang={toBcp47(i.locale)}>{i.translation}</td>
                <td className="a-actions">
                  {canReview && i.reviewable ? (
                    <button type="submit" name="one" value={value(i)} className="a-btn a-btn--small" disabled={pending} aria-label={`${i.reason === 'machine' ? 'Duyệt' : 'Vẫn đúng'}: ${name}`}>
                      {i.reason === 'machine' ? 'Duyệt' : 'Vẫn đúng'}
                    </button>
                  ) : null}
                  <Link href={i.href} className="a-btn a-btn--ghost a-btn--small" aria-label={`Sửa: ${name}`}>
                    Sửa
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {canReview ? (
        <button type="submit" className="a-btn" disabled={pending}>
          Duyệt các mục đã chọn
        </button>
      ) : null}
    </form>
  );
}
