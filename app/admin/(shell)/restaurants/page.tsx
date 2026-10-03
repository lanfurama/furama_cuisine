import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { getBookingSettings, listRestaurantBookings } from '@/lib/server/booking/config';
import { listDestinationOptions } from '@/lib/server/booking/queries';
import { requirePagePermission } from '@/lib/server/dal/session';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Nhà hàng' };

/* Phase 4 keeps this list to each restaurant's booking screen (R16); content editing arrives with phase 7. */
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
      <p className="a-lede">Giờ phục vụ, sức chứa và quy tắc đặt bàn của từng nhà hàng.</p>
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
                <Link href={`/admin/restaurants/${r.id}/booking`}>Giờ và sức chứa</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
