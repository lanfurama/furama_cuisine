import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPool } from '@/db/client';
import { formatIsoDayVi } from '@/lib/admin/format';
import { planDay } from '@/lib/booking/resolve-day';
import { MEALS } from '@/lib/data';
import { STATUS_LABELS } from '@/lib/reservations/lifecycle';
import { roleCan } from '@/lib/server/auth/permissions';
import { findAffected, type AffectedKind } from '@/lib/server/booking/affected';
import { getBookingSettings, getRestaurantBooking, loadPeriods } from '@/lib/server/booking/config';
import { loadBookedCovers, loadRestaurantRules } from '@/lib/server/booking/rules';
import { requirePagePermission } from '@/lib/server/dal/session';
import { isValidIsoDate, venueNow } from '@/lib/venue-time';
import { AffectedList } from '../../../_ui/AffectedList';
import { AutoConfirmForm } from './AutoConfirmForm';
import { PeriodsEditor } from './PeriodsEditor';
import { RulesForm } from './RulesForm';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Giờ và sức chứa' };

const WHY: Record<AffectedKind, string> = {
  closed: 'Rơi vào ngày đóng cửa',
  outside_hours: 'Ngoài giờ phục vụ mới',
  over_capacity: 'Khung giờ vượt sức chứa mới',
};

export default async function RestaurantBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ngay?: string | string[] }>;
}) {
  const staff = await requirePagePermission({ schedule: ['read'] });
  const [{ id }, { ngay }] = await Promise.all([params, searchParams]);
  const pool = getPool();
  const restaurant = await getRestaurantBooking(pool, id);
  if (!restaurant) notFound();
  const previewDate = typeof ngay === 'string' && isValidIsoDate(ngay) ? ngay : venueNow().date;
  const [settings, periods, loaded, booked, affected] = await Promise.all([
    getBookingSettings(pool),
    loadPeriods(pool, id),
    loadRestaurantRules(pool, id, 'vi', previewDate),
    loadBookedCovers(pool, id, previewDate, previewDate),
    findAffected(pool, { restaurantIds: [id] }),
  ]);
  // The preview is the staff view of the day (planDay: no clock, no window, no switch) with the covers held now.
  const preview = loaded ? planDay(loaded.rules, previewDate) : { periods: [] };
  const held = booked[previewDate] ?? {};

  return (
    <>
      <p className="a-crumbs">
        <Link href="/admin/restaurants">← Nhà hàng</Link>
      </p>
      <h1>{`Giờ và sức chứa · ${restaurant.name}`}</h1>
      <p className="a-lede">Lưu xong, khách thấy giờ và chỗ mới ở lần mở form tiếp theo.</p>

      <section aria-labelledby="booking-rules-title">
        <h2 id="booking-rules-title">Đặt bàn online</h2>
        <RulesForm
          restaurant={{
            id: restaurant.id,
            token: restaurant.token,
            bookingEnabled: restaurant.bookingEnabled,
            windowDays: restaurant.windowDays,
            leadMinutes: restaurant.leadMinutes,
            maxParty: restaurant.maxParty,
          }}
          defaults={{ windowDays: settings.windowDays, leadMinutes: settings.leadMinutes, maxParty: settings.maxParty }}
        />
        {/* Admin only (spec §7.1): an Editor never gets the control, and the action refuses them anyway. */}
        {roleCan(staff.role, { reservations: ['auto-confirm'] }) ? (
          <AutoConfirmForm restaurantId={restaurant.id} token={restaurant.token} value={restaurant.autoConfirm} defaultValue={settings.autoConfirm} />
        ) : null}
      </section>

      <section aria-labelledby="booking-periods-title">
        <h2 id="booking-periods-title">Ca phục vụ</h2>
        <PeriodsEditor
          restaurantId={restaurant.id}
          token={restaurant.token}
          meals={[...MEALS]}
          periods={periods.map(({ sortOrder: _sortOrder, ...p }) => p)}
        />
      </section>

      <section aria-labelledby="booking-affected-title">
        <h2 id="booking-affected-title">Đặt bàn sắp tới không còn khớp</h2>
        <AffectedList
          title="Đặt bàn sắp tới không còn khớp giờ hoặc sức chứa"
          items={affected.map((a) => ({
            id: a.id,
            version: a.version,
            reference: a.reference,
            restaurantName: a.restaurantName,
            dayLabel: formatIsoDayVi(a.date),
            time: a.time,
            guests: a.guests,
            name: a.name,
            statusLabel: STATUS_LABELS[a.status],
            why: WHY[a.kind],
          }))}
        />
      </section>

      <section aria-labelledby="booking-preview-title">
        <h2 id="booking-preview-title">Xem trước giờ đặt</h2>
        <form className="a-filter" action={`/admin/restaurants/${id}/booking`}>
          <div className="a-field">
            <label htmlFor="booking-preview-date">Ngày</label>
            <input id="booking-preview-date" name="ngay" type="date" defaultValue={previewDate} />
          </div>
          <button className="a-btn a-btn--ghost" type="submit">
            Xem
          </button>
        </form>
        <p className="a-muted">{`${formatIsoDayVi(previewDate)}${restaurant.bookingEnabled ? '' : ' · đặt bàn online đang tắt'}`}</p>
        <div className="a-preview" role="group" aria-label="Giờ đặt trong ngày">
          {preview.periods.map((p) => (
            <div key={p.periodId}>
              <h3>{`${p.meal}${p.closed ? ' · đóng cửa' : ''}`}</h3>
              <ul className="a-chips">
                {p.slots.map((slot) => {
                  const left = Math.max(0, slot.capacity - (held[slot.time] ?? 0));
                  return (
                    <li key={slot.time} className={!p.closed && left > 0 ? 'a-chip' : 'a-chip a-chip--off'}>
                      {`${slot.time} · ${left}/${slot.capacity}`}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {preview.periods.length === 0 ? <p className="a-muted">Không có ca nào vào thứ này.</p> : null}
        </div>
      </section>
    </>
  );
}
