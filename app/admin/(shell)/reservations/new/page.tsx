import type { Metadata } from 'next';
import { getPool } from '@/db/client';
import { formatIsoDayVi } from '@/lib/admin/format';
import { planDay } from '@/lib/booking/resolve-day';
import { serviceDay } from '@/lib/reservations/lifecycle';
import { listLocales, listRestaurantOptions } from '@/lib/server/booking/queries';
import { loadBookedCovers, loadRestaurantRules } from '@/lib/server/booking/rules';
import { requirePagePermission } from '@/lib/server/dal/session';
import { isValidIsoDate } from '@/lib/venue-time';
import { SectionNav } from '../_ui/SectionNav';
import { NewReservationForm, type SlotOption } from './NewReservationForm';
import { TargetPicker } from './TargetPicker';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Tạo đặt bàn' };

type Search = { nha_hang?: string | string[]; ngay?: string | string[] };
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

/*
 * Two steps on one page: the picker chooses the restaurant and the date (it
 * navigates on change; as a GET form it also works before hydration), so the
 * slot list is the server's planDay for that day (closures included) with the
 * covers held now; the booking form then posts the rest to createReservation,
 * which checks again under the booking-day lock. The form names its target,
 * and refuses to post while the picker shows another one (TargetPicker).
 */
export default async function NewReservationPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePagePermission({ reservations: ['create'] });
  const params = await searchParams;
  const pool = getPool();
  const [restaurants, locales] = await Promise.all([listRestaurantOptions(pool), listLocales(pool)]);
  const today = serviceDay();
  const restaurantId = restaurants.some((r) => r.id === one(params.nha_hang)) ? one(params.nha_hang)! : restaurants[0]?.id;
  const date = isValidIsoDate(one(params.ngay)) ? one(params.ngay)! : today;
  const loaded = restaurantId ? await loadRestaurantRules(pool, restaurantId, 'vi', date) : null;
  const booked = restaurantId ? ((await loadBookedCovers(pool, restaurantId, date, date))[date] ?? {}) : {};
  const plan = loaded ? planDay(loaded.rules, date) : null;

  const slots: SlotOption[] = (plan?.periods ?? [])
    .filter((p) => !p.closed)
    .flatMap((p) =>
      p.slots.map((s) => {
        const left = s.capacity - (booked[s.time] ?? 0);
        return { time: s.time, label: `${s.time} · ${p.meal} · ${left > 0 ? `còn ${left}/${s.capacity}` : 'hết chỗ'}` };
      }),
    );
  const closedMeals = (plan?.periods ?? []).filter((p) => p.closed).map((p) => p.meal);
  const defaultLocale = locales.find((l) => l.isDefault)?.code ?? 'en';

  return (
    <>
      <SectionNav current="/admin/reservations/new" />
      <h1>Tạo đặt bàn</h1>
      <p className="a-lede">Đặt qua điện thoại (đã xác nhận) hoặc khách vãng lai (đã đến, chỉ trong hôm nay).</p>
      <TargetPicker restaurants={restaurants} loaded={{ restaurant: restaurantId ?? '', date }} today={today}>
        {loaded ? (
          <>
            <h2>{`${loaded.rules.restaurantName} · ${formatIsoDayVi(date)}`}</h2>
            {closedMeals.length ? <p className="a-warn">{`Đóng cửa ngày này: ${closedMeals.join(', ')}.`}</p> : null}
            {slots.length === 0 ? (
              <p className="a-lede">Ngày này nhà hàng không có ca nào mở.</p>
            ) : (
              <NewReservationForm
                key={`${restaurantId}|${date}`}
                restaurantId={loaded.rules.restaurantId}
                restaurantName={loaded.rules.restaurantName}
                date={date}
                dateLabel={formatIsoDayVi(date)}
                walkInAllowed={date === today}
                slots={slots}
                locales={locales.map((l) => ({ code: l.code, name: l.name }))}
                defaultLocale={defaultLocale}
              />
            )}
          </>
        ) : null}
      </TargetPicker>
    </>
  );
}
