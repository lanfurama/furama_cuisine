import type { Metadata } from 'next';
import { todayVi } from '@/lib/admin/format';
import { verifySession } from '@/lib/server/dal/session';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Tổng quan' };

export default async function OverviewPage() {
  const staff = await verifySession();
  return (
    <>
      <h1>Tổng quan</h1>
      <p className="a-lede">
        Xin chào, {staff.name}. Hôm nay là <time data-testid="today">{todayVi()}</time>.
      </p>
    </>
  );
}
