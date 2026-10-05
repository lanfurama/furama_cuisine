import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { getBookingSettings, listRestaurantBookings } from '@/lib/server/booking/config';
import { listDestinationOptions } from '@/lib/server/booking/queries';
import { requirePagePermission } from '@/lib/server/dal/session';
import { StringsPanel } from '../content/_ui/StringsPanel';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Nhà hàng' };

/*
 * Each restaurant's two screens: its content (phase 7, /admin/restaurants/[id])
 * and its booking hours and rules (phase 4). Below the list, the words every
 * restaurant page shares (detail.*, spec §6.4): they belong to no one
 * restaurant, so they are edited here, once (registry screen `restaurants`).
 */
export default async function RestaurantsPage() {
  await requirePagePermission({ schedule: ['read'] });
  const pool = getPool();
  const [restaurants, settings, destinations] = await Promise.all([
    listRestaurantBookings(pool),
    getBookingSettings(pool),
    listDestinationOptions(pool),
  ]);
  const destinationName = new Map(destinations.map((d) => [d.id, d.name]));
  return (
    <>
      <h1>Nhà hàng</h1>
      <p className="a-lede">Nội dung, giờ phục vụ, sức chứa và quy tắc đặt bàn của từng nhà hàng.</p>
      <table className="a-table">
        <thead>
          <tr>
            <th scope="col">Nhà hàng</th>
            <th scope="col">Điểm đến</th>
            <th scope="col">Đặt bàn online</th>
            <th scope="col">Khách tối đa</th>
            <th scope="col">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          {restaurants.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>{destinationName.get(r.destinationId) ?? r.destinationId}</td>
              <td>{r.bookingEnabled ? 'Bật' : 'Tắt'}</td>
              <td>{r.maxParty ?? `${settings.maxParty} (mặc định)`}</td>
              <td>
                <Link href={`/admin/restaurants/${r.id}`}>Nội dung</Link> · <Link href={`/admin/restaurants/${r.id}/booking`}>Giờ và sức chứa</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section aria-labelledby="restaurants-copy">
        <h2 id="restaurants-copy">Chữ của trang nhà hàng</h2>
        <p className="a-muted">Nút, nhãn và tiêu đề mọi trang nhà hàng dùng chung (tiếng Anh). Chữ riêng của một nhà hàng sửa ở màn Nội dung của nhà hàng đó.</p>
        <StringsPanel screen="restaurants" title="Chữ trang nhà hàng" />
      </section>
    </>
  );
}
