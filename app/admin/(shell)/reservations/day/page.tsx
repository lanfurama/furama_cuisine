import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { formatLongDateVi } from '@/lib/admin/format';
import { HOLDING_STATUSES } from '@/lib/booking/rules';
import { serviceDay } from '@/lib/reservations/lifecycle';
import { daySheet, listNotes, listRestaurantOptions, type SheetRow } from '@/lib/server/booking/queries';
import { requirePagePermission } from '@/lib/server/dal/session';
import { addDays, isValidIsoDate } from '@/lib/venue-time';
import { SectionNav } from '../_ui/SectionNav';
import { StatusBadge } from '../_ui/StatusBadge';
import { PrintButton } from './PrintButton';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Bảng đặt bàn theo ngày' };

type Search = { ngay?: string | string[]; nha_hang?: string | string[] };
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

/*
 * The host stand's sheet (spec §7.2): per restaurant and service, each slot's
 * covers against its capacity, each booking with the guest's request and the
 * staff notes, and the bookings whose time the current hours no longer have.
 * styles/admin.css @media print drops the shell and the filters.
 */
export default async function DaySheetPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePagePermission({ reservations: ['read'] });
  const params = await searchParams;
  const pool = getPool();
  const date = isValidIsoDate(one(params.ngay)) ? one(params.ngay)! : serviceDay();
  const restaurants = await listRestaurantOptions(pool);
  const restaurantId = restaurants.some((r) => r.id === one(params.nha_hang)) ? one(params.nha_hang)! : null;
  // Without a filter, only the restaurants that have bookings that day.
  const sheet = (await daySheet(pool, date, restaurantId)).filter((r) => restaurantId || r.reservations.length > 0);
  const notes = await listNotes(pool, sheet.flatMap((r) => r.reservations.map((x) => x.id)));
  const link = (d: string) => `/admin/reservations/day?${new URLSearchParams({ ngay: d, ...(restaurantId ? { nha_hang: restaurantId } : {}) })}`;

  return (
    <>
      <SectionNav current="/admin/reservations/day" />
      <h1>{`Đặt bàn ngày ${formatLongDateVi(`${date}T12:00:00+07:00`)}`}</h1>
      <form className="a-filter a-noprint" action="/admin/reservations/day">
        <div className="a-field">
          <label htmlFor="res-day-date">Ngày</label>
          <input id="res-day-date" name="ngay" type="date" defaultValue={date} />
        </div>
        <div className="a-field">
          <label htmlFor="res-day-restaurant">Nhà hàng</label>
          <select id="res-day-restaurant" name="nha_hang" defaultValue={restaurantId ?? ''}>
            <option value="">Tất cả (có đặt bàn)</option>
            {restaurants.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <button className="a-btn a-btn--ghost" type="submit">
          Xem
        </button>
        <Link className="a-btn a-btn--ghost" href={link(addDays(date, -1))}>
          ← Hôm trước
        </Link>
        <Link className="a-btn a-btn--ghost" href={link(addDays(date, 1))}>
          Hôm sau →
        </Link>
        <PrintButton />
      </form>
      {sheet.length === 0 ? <p className="a-lede">Không có đặt bàn nào trong ngày.</p> : null}
      {sheet.map((r) => (
        <section className="a-sheet" key={r.id} aria-label={r.name}>
          {/* Every booking that holds covers counts, its time still a slot or not: the host seats them all. */}
          <h2>{`${r.name} · ${r.reservations.filter(holds).reduce((n, x) => n + x.guests, 0)} khách`}</h2>
          {r.periods.map((period) => {
            const bookings = period.slots.flatMap((slot) =>
              r.reservations
                .filter((x) => x.time === slot.time)
                // The slot's load once, on its first booking.
                .map((x, i) => ({ booking: x, load: i === 0 ? `${slot.booked}/${slot.capacity}` : '' })),
            );
            return (
              <div key={period.periodId} className="a-sheet-service">
                <h3>{`${period.meal}${period.closed ? ' · đóng cửa' : ''}`}</h3>
                {bookings.length === 0 ? <p className="a-muted">Chưa có đặt bàn.</p> : <SheetTable rows={bookings} notes={notes} />}
              </div>
            );
          })}
          {r.outside.length ? (
            // Booked before the hours changed: no slot (so no load), but the host still greets, calls and seats them.
            <div className="a-sheet-service">
              <h3>Ngoài giờ phục vụ hiện tại</h3>
              <p className="a-warn">Giờ của các đặt bàn này không còn trong ca phục vụ hiện tại.</p>
              <SheetTable rows={r.outside.map((x) => ({ booking: x, load: '' }))} notes={notes} />
            </div>
          ) : null}
        </section>
      ))}
    </>
  );
}

const holds = (x: SheetRow) => (HOLDING_STATUSES as readonly string[]).includes(x.status);

/** A service's bookings, or those outside the current hours, with the columns the host reads. */
function SheetTable({ rows, notes }: { rows: { booking: SheetRow; load: string }[]; notes: Awaited<ReturnType<typeof listNotes>> }) {
  return (
    <table className="a-table a-table--compact">
      <thead>
        <tr>
          <th scope="col">Giờ</th>
          <th scope="col">Chỗ</th>
          <th scope="col">Mã</th>
          <th scope="col">Khách</th>
          <th scope="col">Số khách</th>
          <th scope="col">Trạng thái</th>
          <th scope="col">Ghi chú</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ booking: x, load }) => (
          <tr key={x.id}>
            {/* The time on every row: a printed sheet is read line by line. */}
            <td>{x.time}</td>
            <td>{load}</td>
            <td>
              <Link href={`/admin/reservations/${x.id}`}>{x.reference}</Link>
            </td>
            <td>{`${x.name} · ${x.phone}`}</td>
            <td>{x.guests}</td>
            <td>
              <StatusBadge status={x.status} />
            </td>
            <td>
              {x.note ? <span>{`Khách: ${x.note}`}</span> : null}
              {(notes.get(x.id) ?? []).map((n) => (
                <span className="a-sub" key={n.id}>{`Nội bộ: ${n.body}`}</span>
              ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
