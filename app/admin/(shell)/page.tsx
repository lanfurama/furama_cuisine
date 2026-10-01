import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { todayVi } from '@/lib/admin/format';
import { roleCan } from '@/lib/server/auth/permissions';
import { listOpenInvitations } from '@/lib/server/auth/staff-queries';
import { verifySession } from '@/lib/server/dal/session';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Tổng quan' };

/*
 * Phase 3 shows the greeting and, to Admins, invitations whose email failed
 * (spec §7.2 "email lỗi"). Bookings, translations and notification widgets
 * arrive with phases 4, 5 and 8.
 */
export default async function OverviewPage() {
  const staff = await verifySession();
  const failed = roleCan(staff.role, { user: ['list'] })
    ? (await listOpenInvitations(getPool())).filter((i) => i.email_error !== null)
    : [];

  return (
    <>
      <h1>Tổng quan</h1>
      <p className="a-lede">
        Xin chào, {staff.name}. Hôm nay là <time data-testid="today">{todayVi()}</time>.
      </p>
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
