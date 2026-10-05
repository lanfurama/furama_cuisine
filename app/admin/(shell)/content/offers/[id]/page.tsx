import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPool } from '@/db/client';
import { formatDateTimeVi } from '@/lib/admin/format';
import { listRestaurantOptions } from '@/lib/server/booking/queries';
import { listHistory } from '@/lib/server/content-admin/history';
import { getOfferEditor } from '@/lib/server/content-admin/offers';
import { requirePagePermission } from '@/lib/server/dal/session';
import { HistoryPanel } from '../../../_kit/HistoryPanel';
import { restoreOfferAction } from '../actions';
import { DeleteOffer } from '../DeleteOffer';
import { OfferForm } from '../OfferForm';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Ưu đãi' };

/** The History tab's names for the offer's fields (spec §7.5), in form order. */
const LABELS = {
  title: 'Tiêu đề',
  schedule: 'Lịch',
  restaurant_id: 'Nhà hàng',
  venue_override: 'Tên địa điểm',
  price_amount: 'Giá',
  price_basis: 'Cách tính giá',
  currency: 'Tiền tệ',
  valid_from: 'Hiện từ ngày',
  valid_until: 'Hiện đến ngày',
  is_published: 'Hiện/ẩn',
  sort_order: 'Thứ tự',
};

/*
 * One offer: the form, delete, and its History (spec §7.5). A deleted offer
 * keeps this page: its history, and "Khôi phục mục đã xóa", which brings it
 * back under the same id. An id that never had a row is a 404.
 */
export default async function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission({ content: ['read'] });
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const pool = getPool();
  const [editor, history, restaurants] = await Promise.all([getOfferEditor(pool, id), listHistory(pool, 'offers', id), listRestaurantOptions(pool)]);
  if (!editor && history.length === 0) notFound();
  const title = editor?.values.title.en ?? 'Ưu đãi đã xóa';

  return (
    <>
      <p className="a-crumbs">
        <Link href="/admin/content/offers">← Ưu đãi</Link>
      </p>
      <h1>{title}</h1>
      {editor ? (
        <>
          <OfferForm
            id={id}
            token={editor.token}
            values={editor.values}
            restaurants={restaurants}
            lastSaved={{ by: editor.updatedBy, at: formatDateTimeVi(editor.updatedAt) }}
          />
          <DeleteOffer id={id} token={editor.token} title={title} />
        </>
      ) : (
        <p className="a-alert" role="status">
          Ưu đãi này đã bị xóa. Khôi phục từ Lịch sử bên dưới để đưa nó về đúng chỗ cũ.
        </p>
      )}
      <HistoryPanel
        headingId={`offer-${id}-history`}
        entries={history}
        currentToken={editor?.token ?? 'deleted'}
        recordId={id}
        labels={LABELS}
        restore={restoreOfferAction}
      />
    </>
  );
}
