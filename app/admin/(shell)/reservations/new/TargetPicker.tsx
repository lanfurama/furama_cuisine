'use client';

import { useRouter } from 'next/navigation';
import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import { isValidIsoDate } from '@/lib/venue-time';

export type Target = { restaurant: string; date: string };

/*
 * What the picker shows now. The booking form compares it with the target the
 * page was rendered for: while they differ, the times on screen belong to the
 * old target (the navigation to the new one is in flight, or the date is not
 * a whole date yet), so the form must not post.
 */
const PickedTarget = createContext<Target | null>(null);

export function usePickedTarget(): Target | null {
  return useContext(PickedTarget);
}

/*
 * The restaurant and date pickers apply themselves: staff who change one and
 * go straight to the booking form used to book the target last loaded, not
 * the one shown. Each change replaces the URL (no history entry per click,
 * node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md:45;
 * scroll: false keeps the page where it is, :118-120); the page then renders
 * the new target's times and remounts the booking form (its key). A newer
 * navigation discards an older one still in flight
 * (node_modules/next/dist/client/components/app-router-instance.js:147-150),
 * so the target that lands is the last one picked. "Xem giờ trống" stays: the
 * same form as a plain GET works before hydration.
 */
export function TargetPicker({
  restaurants,
  loaded,
  today,
  children,
}: {
  restaurants: { id: string; name: string }[];
  loaded: Target;
  today: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Target>(loaded);
  const [shown, setShown] = useState<Target>(loaded);
  const uid = useId();
  // The page re-rendered for another target (a pick landing, the back button, a menu link to the bare
  // page): the controls follow it. Cache Components keeps this component's state across those
  // navigations (preserving-ui-state.md:255), so it is adjusted during render, not by a remount.
  if (shown.restaurant !== loaded.restaurant || shown.date !== loaded.date) {
    setShown(loaded);
    setPicked(loaded);
  }
  const pick = (next: Target) => {
    setPicked(next);
    // A half-typed or cleared date stays on screen; there is nothing to load until it is a date.
    if (!isValidIsoDate(next.date)) return;
    router.replace(`/admin/reservations/new?${new URLSearchParams({ nha_hang: next.restaurant, ngay: next.date })}`, { scroll: false });
  };

  return (
    <PickedTarget value={picked}>
      <form className="a-filter" action="/admin/reservations/new" aria-label="Chọn nhà hàng và ngày">
        <div className="a-field">
          <label htmlFor={`${uid}-pick-restaurant`}>Nhà hàng</label>
          <select
            id={`${uid}-pick-restaurant`}
            name="nha_hang"
            value={picked.restaurant}
            onChange={(e) => pick({ ...picked, restaurant: e.currentTarget.value })}
          >
            {restaurants.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <div className="a-field">
          <label htmlFor={`${uid}-pick-date`}>Ngày</label>
          <input
            id={`${uid}-pick-date`}
            name="ngay"
            type="date"
            value={picked.date}
            min={today}
            onChange={(e) => pick({ ...picked, date: e.currentTarget.value })}
          />
        </div>
        <button className="a-btn a-btn--ghost" type="submit">
          Xem giờ trống
        </button>
      </form>
      {children}
    </PickedTarget>
  );
}
