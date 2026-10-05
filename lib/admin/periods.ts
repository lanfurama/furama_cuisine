import { seatings } from '@/lib/booking/resolve-day';
import { MEALS, type Meal } from '@/lib/data';

/*
 * The periods editor's rows on "Giờ và sức chứa" (spec §10.1), as the browser
 * holds them before a save: pure, so the editor and its tests share them.
 */

export type PeriodDraft = {
  id: string | null;
  meal: string;
  weekdays: number[];
  firstSeating: string;
  lastSeating: string;
  intervalMin: number;
  /** '' while staff have cleared the field: kept as typed, never turned into 0 (phase-4 ledger T11). */
  coversPerSlot: number | '';
  active: boolean;
};

/** Each meal's usual hours, 30 minutes apart: none of them shares a time with another (R6). */
export const MEAL_HOURS: Record<Meal, { firstSeating: string; lastSeating: string }> = {
  Breakfast: { firstSeating: '07:00', lastSeating: '10:00' },
  Lunch: { firstSeating: '11:30', lastSeating: '14:00' },
  Dinner: { firstSeating: '18:00', lastSeating: '21:00' },
  Drinks: { firstSeating: '21:30', lastSeating: '23:30' },
};

const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];

/** Whether two switched-on periods share a weekday and a seating time (R6, as overlappingPeriods saves it). */
function clash(a: PeriodDraft, b: PeriodDraft): boolean {
  if (!a.active || !b.active || !a.weekdays.some((d) => b.weekdays.includes(d))) return false;
  const times = new Set(seatings(b));
  return seatings(a).some((t) => times.has(t));
}

/**
 * The row "Thêm ca" adds: the first meal the restaurant has no period for,
 * at that meal's usual hours, when they share no time with a switched-on
 * period (R6 refuses an overlap: the old default, 18:00–21:00 for whatever
 * meal came first, clashed with Dinner, phase-4 ledger T11). With no such
 * meal the row starts switched off, which can never clash: staff choose its
 * hours, then switch it on.
 */
export function newPeriod(rows: readonly PeriodDraft[], meals: readonly Meal[] = MEALS): PeriodDraft {
  const base = { id: null, intervalMin: 30, coversPerSlot: 20 } as const;
  for (const meal of meals) {
    if (rows.some((r) => r.meal === meal)) continue;
    const row: PeriodDraft = { ...base, weekdays: [...EVERY_DAY], meal, ...MEAL_HOURS[meal], active: true };
    if (!rows.some((r) => clash(r, row))) return row;
  }
  return { ...base, weekdays: [...EVERY_DAY], meal: meals[0], ...MEAL_HOURS[meals[0]], active: false };
}

/**
 * Each row's name in its fields' labels ("Giờ cuối của ca Dinner"): the meal,
 * numbered only when two rows share it ("Dinner 1", "Dinner 2"), so every
 * field has its own accessible name (phase-4 ledger T11).
 */
export function periodNames(rows: readonly Pick<PeriodDraft, 'meal'>[]): string[] {
  return rows.map((row, i) => {
    const same = rows.filter((r) => r.meal === row.meal);
    return same.length === 1 ? row.meal : `${row.meal} ${rows.slice(0, i + 1).filter((r) => r.meal === row.meal).length}`;
  });
}
