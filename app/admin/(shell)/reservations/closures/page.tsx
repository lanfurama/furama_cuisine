import type { Metadata } from 'next';
import { getPool } from '@/db/client';
import { formatIsoDayVi } from '@/lib/admin/format';
import { MEALS } from '@/lib/data';
import { STATUS_LABELS } from '@/lib/reservations/lifecycle';
import { findAffected } from '@/lib/server/booking/affected';
import { listClosures } from '@/lib/server/booking/config';
import { listRestaurantOptions } from '@/lib/server/booking/queries';
import { listDestinationOptions } from '@/lib/server/content-admin/destinations';
import { requirePagePermission } from '@/lib/server/dal/session';
import { venueNow } from '@/lib/venue-time';
import { AffectedList } from '../../_ui/AffectedList';
import { SectionNav } from '../_ui/SectionNav';
import { ClosureEditor, DeleteClosure, type ClosureValues } from './ClosureForm';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Ngày đóng cửa' };

const SCOPE_LABELS = { all: 'Tất cả nhà hàng', destination: 'Điểm đến', restaurant: 'Nhà hàng' } as const;

/** "Bữa Lunch, Dinner", or "cả ngày" when no meal is named. */
const closureMeals = (meals: readonly string[] | null) => (meals?.length ? `Bữa ${meals.join(', ')}` : 'cả ngày');

export default async function ClosuresPage() {
  await requirePagePermission({ schedule: ['read'] });
  const pool = getPool();
  const [closures, restaurants, destinations] = await Promise.all([
    listClosures(pool, venueNow().date),
    listRestaurantOptions(pool),
    listDestinationOptions(pool),
  ]);
  // Each closure's own list (spec §10.1): never acted on automatically.
  const affected = await Promise.all(closures.map((c) => findAffected(pool, { closureId: c.id })));
  const restaurantName = new Map(restaurants.map((r) => [r.id, r.name]));
  const destinationName = new Map(destinations.map((d) => [d.id, d.name]));
  const options = {
    restaurants,
    destinations,
    meals: [...MEALS],
  };

  return (
    <>
      <SectionNav current="/admin/reservations/closures" />
      <h1>Ngày đóng cửa</h1>
      <p className="a-lede">Khách không đặt được bàn vào những ngày, bữa đã đóng. Đặt bàn đã có không bị hủy tự động.</p>
      <ClosureEditor options={options} values={null} />
      {closures.length === 0 ? <p className="a-lede">Chưa có ngày đóng cửa nào sắp tới.</p> : null}
      {closures.map((c, i) => {
        const where =
          c.scope === 'all'
            ? SCOPE_LABELS.all
            : c.scope === 'destination'
              ? `${SCOPE_LABELS.destination}: ${destinationName.get(c.destinationId ?? '') ?? c.destinationId}`
              : `${SCOPE_LABELS.restaurant}: ${restaurantName.get(c.restaurantId ?? '') ?? c.restaurantId}`;
        const values: ClosureValues = {
          id: c.id,
          token: c.token,
          scope: c.scope,
          destinationId: c.destinationId,
          restaurantId: c.restaurantId,
          startsOn: c.startsOn,
          endsOn: c.endsOn,
          meals: c.meals ?? [],
          showReason: c.showReason,
          reasonEn: c.publicReason.en ?? '',
          reasonVi: c.publicReason.vi ?? '',
          internalNote: c.internalNote ?? '',
        };
        // The meals belong in the title: two closures on the same dates, lunch and dinner, read apart (phase-4 T13).
        const title = `${where} · ${formatIsoDayVi(c.startsOn)}${c.endsOn !== c.startsOn ? ` – ${formatIsoDayVi(c.endsOn)}` : ''} · ${closureMeals(c.meals)}`;
        return (
          <section className="a-card-row" key={c.id} aria-label={title}>
            <h2>{title}</h2>
            {Object.values(c.publicReason).some(Boolean) || c.internalNote ? (
              <p>
                {[
                  // Every language's reason, each named (phase-4 T13: the card showed English only).
                  ...Object.entries(c.publicReason)
                    .filter(([, reason]) => reason)
                    .map(([locale, reason]) => `Lý do cho khách (${locale.toUpperCase()}): ${reason}`),
                  Object.values(c.publicReason).some(Boolean) && !c.showReason ? '(lý do đang ẩn)' : null,
                  c.internalNote ? `Ghi chú nội bộ: ${c.internalNote}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            ) : null}
            <details>
              <summary>Sửa</summary>
              <ClosureEditor options={options} values={values} />
            </details>
            <DeleteClosure values={values} />
            <h3>Đặt bàn bị ảnh hưởng</h3>
            <AffectedList
              title={`Đặt bàn bị ảnh hưởng bởi ${title}`}
              items={affected[i].map((a) => ({
                id: a.id,
                version: a.version,
                reference: a.reference,
                restaurantName: a.restaurantName,
                dayLabel: formatIsoDayVi(a.date),
                time: a.time,
                guests: a.guests,
                name: a.name,
                phone: a.phone,
                hasEmail: a.hasEmail,
                statusLabel: STATUS_LABELS[a.status],
                why: 'Nằm trong ngày đóng cửa',
              }))}
            />
          </section>
        );
      })}
    </>
  );
}
