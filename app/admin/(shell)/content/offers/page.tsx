import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { limitWarnings } from '@/lib/admin/content-rules';
import { formatDateTimeVi } from '@/lib/admin/format';
import { listDeleted, listHistory } from '@/lib/server/history/history';
import { listOffersAdmin, OFFER } from '@/lib/server/content-admin/offers';
import { orderToken, type OrderSnapshot } from '@/lib/server/history/snapshot';
import { requirePagePermission } from '@/lib/server/dal/session';
import { Icon } from '../../../_ui/Icon';
import { PageHeader } from '../../../_ui/PageHeader';
import { HistoryPanel } from '../../_kit/HistoryPanel';
import { StringsPanel, type ScreenSearchParams } from '../_ui/StringsPanel';
import { restoreOfferOrderAction } from './actions';
import { OfferList } from './OfferList';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Ưu đãi' };

/* Spec §7.2 content/offers: the list (order, show/hide, delete), the deleted ones to restore, and the order's history. */
export default async function OffersPage({ searchParams }: { searchParams: ScreenSearchParams }) {
  await requirePagePermission({ content: ['read'] });
  const pool = getPool();
  const [{ items, token }, deleted, orderHistory] = await Promise.all([listOffersAdmin(pool), listDeleted(pool, OFFER), listHistory(pool, 'offers', null, 10)]);
  const titleOf = (before: Record<string, unknown>) =>
    (before.i18n as { locale: string; title?: string }[] | undefined)?.find((r) => r.locale === 'en')?.title ??
    `Ưu đãi ${String((before.row as { id?: unknown })?.id ?? '')}`;

  return (
    <>
      <PageHeader
        back={<Link href="/admin/content">← Nội dung</Link>}
        title="Ưu đãi"
        lede="Thẻ ưu đãi ở trang chủ, theo thứ tự khách thấy. Lưu là lên web ngay; mọi thay đổi khôi phục được từ Lịch sử."
        actions={
          <>
            <a className="a-btn a-btn--ghost" href="/en#offers" target="_blank" rel="noopener">
              <Icon name="external" size={16} />
              Xem trên web
            </a>
            <Link className="a-btn" href="/admin/content/offers/new">
              <Icon name="plus" size={16} />
              Thêm ưu đãi
            </Link>
          </>
        }
      />
      <OfferList items={items} listToken={token} warnings={limitWarnings('offers', items.filter((i) => i.isPublished).length)} />

      <section aria-labelledby="offers-copy" className="a-card-row">
        <h2 id="offers-copy">Chữ của mục Offers</h2>
        <p className="a-muted">Tiêu đề, câu dẫn, nút trên thẻ, cách ghi giá và ghi chú điền sẵn vào form đặt bàn.</p>
        <StringsPanel searchParams={searchParams} screen="offers" title="Chữ mục Offers" />
      </section>

      <section aria-labelledby="offers-deleted" className="a-card-row">
        <h2 id="offers-deleted">Đã xóa gần đây</h2>
        {deleted.length === 0 ? (
          <p className="a-muted">Không có ưu đãi nào bị xóa.</p>
        ) : (
          <ul className="a-list">
            {deleted.map((d) => (
              <li key={d.id} className="a-list-item">
                <Link href={`/admin/content/offers/${d.id}`}>{titleOf(d.before)}</Link>
                <span className="a-muted">
                  {' '}
                  · xóa bởi {d.actor} lúc {formatDateTimeVi(d.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <HistoryPanel
        title="Lịch sử thứ tự"
        headingId="offers-order-history"
        entries={orderHistory}
        currentToken={token}
        recordId="offers"
        labels={{}}
        restore={restoreOfferOrderAction}
        tokenOf={(s: OrderSnapshot) => orderToken(s)}
        describe={(e) => {
          const order = (e.after as OrderSnapshot | null)?.order ?? [];
          return `Thứ tự: ${order.map((o) => o.id).join(', ')}`;
        }}
      />
    </>
  );
}
