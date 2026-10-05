import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { formatDateTimeVi, formatIsoDayVi } from '@/lib/admin/format';
import { SOURCE_LABELS } from '@/lib/reservations/lifecycle';
import { readInboxSearch } from '@/lib/server/booking/inbox-search';
import { INBOX_TABS, listInbox, type InboxTab } from '@/lib/server/booking/queries';
import { requirePagePermission } from '@/lib/server/dal/session';
import { venueNow } from '@/lib/venue-time';
import { QuickConfirm } from './QuickConfirm';
import { searchReservations } from './actions';
import { SectionNav } from './_ui/SectionNav';
import { StatusBadge } from './_ui/StatusBadge';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Đặt bàn' };

const TAB_LABELS: Record<InboxTab, string> = { pending: 'Cần xử lý', today: 'Hôm nay', upcoming: 'Sắp tới', all: 'Tất cả' };

/* `tim` is the id of a search kept in a cookie (lib/server/booking/inbox-search.ts); the text itself never rides in the URL. */
type Search = { tab?: string | string[]; tim?: string | string[]; sau?: string | string[] };
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function ReservationsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePagePermission({ reservations: ['read'] });
  const params = await searchParams;
  const tab = (INBOX_TABS as readonly string[]).includes(one(params.tab) ?? '') ? (one(params.tab) as InboxTab) : 'pending';
  const searchId = one(params.tim);
  const saved = await readInboxSearch(searchId);
  const q = saved && saved !== 'expired' ? saved.q : '';
  // An expired search starts its tab over: page 2 of results that are gone is no page (phase-5 T12.5).
  const after = saved === 'expired' ? undefined : one(params.sau);
  // "Hôm nay" is Da Nang's date, whatever the server's timezone.
  const { rows, next, searched } = await listInbox(getPool(), { tab, q, after, today: venueNow().date });
  const shownTab: InboxTab = searched ? 'all' : tab;
  const query = (extra: Record<string, string>) =>
    new URLSearchParams({ ...(searched && searchId ? { tim: searchId } : shownTab !== 'pending' ? { tab: shownTab } : {}), ...extra }).toString();

  return (
    <>
      <SectionNav current="/admin/reservations" />
      <h1>Đặt bàn</h1>
      <form className="a-search" role="search" action={searchReservations}>
        <label htmlFor="inbox-q">Tìm theo mã, số điện thoại, tên hoặc email</label>
        <div className="a-search-row">
          <input id="inbox-q" name="q" type="search" defaultValue={q} placeholder="FC-7K3QH9XA, 0905…, Nguyễn…" />
          <button className="a-btn" type="submit">
            Tìm
          </button>
        </div>
      </form>
      {saved === 'expired' ? (
        <p className="a-lede" role="status">
          Kết quả tìm kiếm đã hết hạn. Hãy tìm lại.
        </p>
      ) : null}
      {searched ? (
        <p className="a-lede">
          {`Kết quả cho “${q}” trong mọi đặt bàn. `}
          <Link href="/admin/reservations">Xóa tìm kiếm</Link>
        </p>
      ) : (
        <nav className="a-tabs" aria-label="Lọc đặt bàn">
          {INBOX_TABS.map((t) => (
            <Link key={t} href={t === 'pending' ? '/admin/reservations' : `/admin/reservations?tab=${t}`} aria-current={t === tab ? 'page' : undefined}>
              {TAB_LABELS[t]}
            </Link>
          ))}
        </nav>
      )}
      {rows.length === 0 ? (
        <p className="a-lede">Không có đặt bàn nào.</p>
      ) : (
        <table className="a-table">
          <thead>
            <tr>
              <th scope="col">Mã</th>
              <th scope="col">Khách</th>
              <th scope="col">Nhà hàng</th>
              <th scope="col">Ngày giờ</th>
              <th scope="col">Số khách</th>
              <th scope="col">Trạng thái</th>
              <th scope="col">Nguồn · tạo lúc</th>
              <th scope="col">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="a-ref">
                  <Link href={`/admin/reservations/${r.id}`}>{r.reference}</Link>
                  {r.isTest ? <span className="a-tag">Test</span> : null}
                </td>
                <td>
                  {r.name}
                  <small className="a-sub">{r.phone}</small>
                </td>
                <td>
                  {r.restaurantName}
                  {r.offerTitle ? <small className="a-sub">{`Ưu đãi: ${r.offerTitle}`}</small> : null}
                </td>
                <td>{`${formatIsoDayVi(r.date)} ${r.time}`}</td>
                <td>
                  {r.guests}
                  {r.overCapacity ? <span className="a-tag a-tag--warn">Vượt sức chứa</span> : null}
                </td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td>
                  {SOURCE_LABELS[r.source] ?? r.source}
                  <small className="a-sub">{formatDateTimeVi(r.createdAt)}</small>
                </td>
                <td>{r.status === 'requested' ? <QuickConfirm id={r.id} version={r.version} reference={r.reference} /> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {next || after ? (
        <nav className="a-pager" aria-label="Phân trang">
          {after ? <Link href={`/admin/reservations?${query({})}`}>← Trang đầu</Link> : null}
          {next ? <Link href={`/admin/reservations?${query({ sau: next })}`}>Trang sau →</Link> : null}
        </nav>
      ) : null}
    </>
  );
}
