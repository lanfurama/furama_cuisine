import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { todayVi } from '@/lib/admin/format';
import { roleCan } from '@/lib/server/auth/permissions';
import { listOpenInvitations } from '@/lib/server/auth/staff-queries';
import { overviewCounts } from '@/lib/server/booking/queries';
import { verifySession } from '@/lib/server/dal/session';
import { outboxEnv } from '@/lib/server/email/env';
import { emailOverview } from '@/lib/server/email/outbox-log';
import { venueNow } from '@/lib/venue-time';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Tổng quan' };

/*
 * The greeting; bookings waiting for staff and today's bookings (spec §7.2
 * "đặt bàn chờ xử lý"), with the booking emails of this environment that used
 * up their attempts ("email lỗi", §10.4, §12) and those retrying after a
 * failure (an SMTP outage shows within minutes), both only for sittings still
 * ahead, for roles that read bookings;
 * to Admins, invitations whose email failed, and the restaurants whose "đặt
 * bàn mới" goes to the shared inbox ("nhà hàng chưa có người nhận thông báo",
 * R21). Translation widgets arrive with phase 8.
 */
export default async function OverviewPage() {
  const staff = await verifySession();
  const pool = getPool();
  const failed = roleCan(staff.role, { user: ['list'] }) ? (await listOpenInvitations(pool)).filter((i) => i.email_error !== null) : [];
  // Today is Da Nang's date, whatever the server's timezone.
  const bookings = roleCan(staff.role, { reservations: ['read'] }) ? await overviewCounts(pool, venueNow().date) : null;
  const emails = bookings ? await emailOverview(pool, outboxEnv()) : null;
  const unrouted = emails && roleCan(staff.role, { settings: ['read'] }) ? emails.unrouted : [];

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
            <li>
              <Link href="/admin/reservations/emails?tab=failed" data-testid="failed-emails">
                <strong>{emails?.failed ?? 0}</strong> email lỗi
              </Link>
            </li>
            <li>
              <Link href="/admin/reservations/emails?tab=queued" data-testid="retrying-emails">
                <strong>{emails?.retrying ?? 0}</strong> email đang thử lại
              </Link>
            </li>
          </ul>
        </section>
      ) : null}
      {unrouted.length > 0 ? (
        <section aria-labelledby="overview-unrouted">
          <h2 id="overview-unrouted">Nhà hàng chưa có người nhận thông báo</h2>
          <p className="a-warn" data-testid="uncovered-restaurants">
            {`${unrouted.length} nhà hàng: ${unrouted.map((r) => r.name).join(', ')}. Email đặt bàn mới của các nhà hàng này đang về hộp thư chung.`}
          </p>
          <p>
            <Link href="/admin/settings/notifications">Mở Thông báo email để thêm người nhận</Link>
          </p>
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
