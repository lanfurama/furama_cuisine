import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { getBookingSettings, listRestaurantBookings } from '@/lib/server/booking/config';
import { listDestinationOptions } from '@/lib/server/booking/queries';
import { listHistory } from '@/lib/server/content-admin/history';
import { listRestaurantsAdmin } from '@/lib/server/content-admin/restaurants';
import { orderToken, type OrderSnapshot } from '@/lib/server/content-admin/snapshot';
import { requirePagePermission } from '@/lib/server/dal/session';
import { HistoryPanel } from '../_kit/HistoryPanel';
import { Thumb } from '../_kit/Thumb';
import { StringsPanel } from '../content/_ui/StringsPanel';
import { restoreRestaurantOrderAction } from './actions';
import { NewRestaurantForm } from './NewRestaurantForm';
import { RestaurantOrder } from './RestaurantOrder';
import { RestaurantSwitches } from './RestaurantSwitches';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Nhà hàng' };

/*
 * Spec §7.2 /admin/restaurants: every restaurant, archived ones too, with
 * whether guests see it, its two screens (its content, phase 7; its booking
 * hours and rules, phase 4), its switches (shown, archived: R22, F10), the
 * catalogue's order with its History, "Thêm nhà hàng", and the words every
 * restaurant card and page shares (restaurants.*, detail.*): they belong to no
 * one restaurant, so they are edited here, once (registry screen `restaurants`).
 */
export default async function RestaurantsPage() {
  await requirePagePermission({ schedule: ['read'] });
  const pool = getPool();
  const [{ items, token }, bookings, settings, destinations, orderHistory] = await Promise.all([
    listRestaurantsAdmin(pool),
    listRestaurantBookings(pool),
    getBookingSettings(pool),
    listDestinationOptions(pool),
    listHistory(pool, 'restaurants', null, 10),
  ]);
  const booking = new Map(bookings.map((b) => [b.id, b]));
  return (
    <>
      <h1>Nhà hàng</h1>
      <p className="a-lede">Nội dung, giờ phục vụ, sức chứa và quy tắc đặt bàn của từng nhà hàng. Nhà hàng không bao giờ bị xóa: lưu trữ để rời web.</p>
      <table className="a-table">
        <thead>
          <tr>
            <th scope="col">Nhà hàng</th>
            <th scope="col">Điểm đến</th>
            <th scope="col">Trên web</th>
            <th scope="col">Đặt bàn online</th>
            <th scope="col">Khách tối đa</th>
            <th scope="col">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => {
            const b = booking.get(r.id);
            return (
              <tr key={r.id}>
                <td>
                  {r.card ? <Thumb file={r.card} width={48} className="a-picker-thumb" /> : null} {r.name}
                </td>
                <td>{r.destinationName}</td>
                <td>
                  <span className={r.isPublished && !r.archived ? 'a-tag' : 'a-tag a-tag--warn'}>
                    {r.archived ? 'Đã lưu trữ' : r.isPublished ? 'Đang hiện' : 'Đang ẩn'}
                  </span>
                </td>
                <td>{b?.bookingEnabled ? 'Bật' : 'Tắt'}</td>
                <td>{b?.maxParty ?? `${settings.maxParty} (mặc định)`}</td>
                <td>
                  <Link href={`/admin/restaurants/${r.id}`}>Nội dung</Link> · <Link href={`/admin/restaurants/${r.id}/booking`}>Giờ và sức chứa</Link>
                  <RestaurantSwitches id={r.id} name={r.name} token={r.token} shown={r.isPublished} archived={r.archived} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <section aria-labelledby="restaurants-order" className="a-section-card">
        <h2 id="restaurants-order">Thứ tự trên web</h2>
        <p className="a-muted">Thứ tự thẻ ở trang chủ, ở “More at …” và trong form đặt bàn.</p>
        <RestaurantOrder items={items} listToken={token} />
      </section>

      <HistoryPanel
        title="Lịch sử thứ tự nhà hàng"
        headingId="restaurants-order-history"
        entries={orderHistory}
        currentToken={token}
        recordId="restaurants"
        labels={{}}
        restore={restoreRestaurantOrderAction}
        tokenOf={(s: OrderSnapshot) => orderToken(s)}
        describe={(e) => `Thứ tự: ${((e.after as OrderSnapshot | null)?.order ?? []).map((o) => o.id).join(', ')}`}
      />

      <section aria-labelledby="restaurants-new" className="a-section-card">
        <h2 id="restaurants-new">Thêm nhà hàng</h2>
        <NewRestaurantForm destinations={destinations} />
      </section>

      <section aria-labelledby="restaurants-copy">
        <h2 id="restaurants-copy">Chữ của mục nhà hàng và trang nhà hàng</h2>
        <p className="a-muted">Tiêu đề, nút và nhãn mọi thẻ và trang nhà hàng dùng chung (tiếng Anh). Chữ riêng của một nhà hàng sửa ở màn Nội dung của nhà hàng đó.</p>
        <StringsPanel
          screen="restaurants"
          title="Chữ trang nhà hàng"
          groups={[
            { title: 'Mục Our Restaurants và thẻ nhà hàng', prefix: 'restaurants.' },
            { title: 'Trang nhà hàng', prefix: 'detail.' },
          ]}
        />
      </section>
    </>
  );
}
