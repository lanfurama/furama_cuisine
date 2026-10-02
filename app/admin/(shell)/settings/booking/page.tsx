import type { Metadata } from 'next';
import { getPool } from '@/db/client';
import { getBookingSettings } from '@/lib/server/booking/config';
import { requirePagePermission } from '@/lib/server/dal/session';
import { SettingsForm } from './SettingsForm';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Cài đặt đặt bàn' };

export default async function BookingSettingsPage() {
  // Before any query: an Editor gets the 403 view.
  await requirePagePermission({ settings: ['read'] });
  const settings = await getBookingSettings(getPool());
  return (
    <>
      <h1>Cài đặt đặt bàn</h1>
      <p className="a-lede">Mặc định cho mọi nhà hàng; từng nhà hàng có thể ghi đè trong “Giờ và sức chứa”.</p>
      <SettingsForm settings={settings} />
    </>
  );
}
