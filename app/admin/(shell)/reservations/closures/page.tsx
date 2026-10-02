import type { Metadata } from 'next';
import { getPool } from '@/db/client';
import { formatIsoDayVi } from '@/lib/admin/format';
import { DESTS, MEALS, type DestKey } from '@/lib/data';
import { STATUS_LABELS } from '@/lib/reservations/lifecycle';
import { findAffected } from '@/lib/server/booking/affected';
import { listClosures } from '@/lib/server/booking/config';
import { listRestaurantOptions } from '@/lib/server/booking/queries';
import { requirePagePermission } from '@/lib/server/dal/session';
import { venueNow } from '@/lib/venue-time';
import { AffectedList } from '../../_ui/AffectedList';
import { SectionNav } from '../_ui/SectionNav';
import { ClosureEditor, DeleteClosure, type ClosureValues } from './ClosureForm';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Ngày đóng cửa' };

const SCOPE_LABELS = { all: 'Tất cả nhà hàng', destination: 'Điểm đến', restaurant: 'Nhà hàng' } as const;

export default async function ClosuresPage() {
  await requirePagePermission({ schedule: ['read'] });
  const pool = getPool();
  const [closures, restaurants] = await Promise.all([listClosures(pool, venueNow().date), listRestaurantOptions(pool)]);
  // Each closure's own list (spec §10.1): never acted on automatically.
  const affected = await Promise.all(closures.map((c) => findAffected(pool, { closureId: c.id })));
  const restaurantName = new Map(restaurants.map((r) => [r.id, r.name]));
  const options = {
    restaurants,
    destinations: Object.entries(DESTS).map(([id, name]) => ({ id, name })),
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
              ? `${SCOPE_LABELS.destination}: ${DESTS[c.destinationId as DestKey] ?? c.destinationId}`
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
        const title = `${where} · ${formatIsoDayVi(c.startsOn)}${c.endsOn !== c.startsOn ? ` – ${formatIsoDayVi(c.endsOn)}` : ''}`;
        return (
          <section className="a-card-row" key={c.id} aria-label={title}>
            <h2>{title}</h2>
            <p>
              {c.meals ? `Bữa: ${c.meals.join(', ')}` : 'Cả ngày'}
              {c.publicReason.en ? ` · Lý do cho khách: ${c.publicReason.en}${c.showReason ? '' : ' (đang ẩn)'}` : ''}
              {c.internalNote ? ` · Ghi chú nội bộ: ${c.internalNote}` : ''}
            </p>
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
