import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { todayVi } from '@/lib/admin/format';
import { roleCan } from '@/lib/server/auth/permissions';
import { listOpenInvitations } from '@/lib/server/auth/staff-queries';
import { overviewCounts } from '@/lib/server/booking/queries';
import { verifySession } from '@/lib/server/dal/session';
import { venueNow } from '@/lib/venue-time';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Tổng quan' };

/*
 * The greeting; bookings waiting for staff and today's bookings (spec §7.2
 * "đặt bàn chờ xử lý"), for roles that read bookings; to Admins, invitations
 * whose email failed ("email lỗi"). Translation and notification widgets
 * arrive with phases 5 and 8.
 */
export default async function OverviewPage() {
  const staff = await verifySession();
  const pool = getPool();
  const failed = roleCan(staff.role, { user: ['list'] }) ? (await listOpenInvitations(pool)).filter((i) => i.email_error !== null) : [];
  // Today is Da Nang's date, whatever the server's timezone.
  const bookings = roleCan(staff.role, { reservations: ['read'] }) ? await overviewCounts(pool, venueNow().date) : null;

  return (
    <>
      <h1>Tổng quan</h1>
      <p className="a-lede">
        Xin chào, {staff.name}. Hôm nay là <time data-testid="today">{todayVi()}</time>.
      </p>
      {bookings ? (
        <section aria-labelledby="overview-bookings">
          <h2 id="overview-bookings">Đặt bàn</h2>
          <ul className="a-stats">
            <li>
              <Link href="/admin/reservations" data-testid="pending-count">
                <strong>{bookings.pending}</strong> chờ xác nhận
              </Link>
            </li>
            <li>
              <Link href="/admin/reservations?tab=today" data-testid="today-count">
                <strong>{bookings.today}</strong> đặt bàn hôm nay · {bookings.todayCovers} khách
              </Link>
            </li>
          </ul>
        </section>
      ) : null}
      {failed.length > 0 ? (
        <section aria-labelledby="failed-invitations">
          <h2 id="failed-invitations">Lời mời chưa gửi được email</h2>
          <ul className="a-list">
            {failed.map((i) => (
              <li className="a-list-item" key={i.id}>
                {i.email}
              </li>
            ))}
          </ul>
          <p>
            <Link href="/admin/users">Mở trang Nhân viên để gửi lại</Link>
          </p>
        </section>
      ) : null}
    </>
  );
}
