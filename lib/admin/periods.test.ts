import { describe, expect, it } from 'vitest';
import { seatings } from '@/lib/booking/resolve-day';
import { MEALS } from '@/lib/data';
import { MEAL_HOURS, newPeriod, periodNames, type PeriodDraft } from './periods';

const row = (meal: string, over: Partial<PeriodDraft> = {}): PeriodDraft => ({
  id: '1',
  meal,
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  firstSeating: '18:00',
  lastSeating: '21:00',
  intervalMin: 30,
  coversPerSlot: 22,
  active: true,
  ...over,
});

describe('the periods editor’s rows', () => {
  it('each meal’s usual hours share no seating time with another’s, and land on the 30-minute grid', () => {
    const all = MEALS.flatMap((m) => seatings({ ...MEAL_HOURS[m], intervalMin: 30 }));
    expect(new Set(all).size).toBe(all.length);
    for (const m of MEALS) expect(seatings({ ...MEAL_HOURS[m], intervalMin: 30 }).at(-1)).toBe(MEAL_HOURS[m].lastSeating);
  });

  it('"Thêm ca" next to Lunch and Dinner adds Breakfast at its own hours, switched on: nothing for R6 to refuse (phase-4 T11)', () => {
    const lunch = row('Lunch', { ...MEAL_HOURS.Lunch });
    expect(newPeriod([lunch, row('Dinner')])).toEqual({
      id: null,
      meal: 'Breakfast',
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      firstSeating: '07:00',
      lastSeating: '10:00',
      intervalMin: 30,
      coversPerSlot: 20,
      active: true,
    });
  });

  it('skips a meal whose usual hours a switched-on row already holds, and a meal the restaurant has', () => {
    const earlyLunch = row('Lunch', { firstSeating: '07:00', lastSeating: '09:00' });
    expect(newPeriod([earlyLunch, row('Dinner')]).meal).toBe('Drinks');
    expect(newPeriod([{ ...earlyLunch, active: false }, row('Dinner')]).meal).toBe('Breakfast');
  });

  it('with every meal taken the new row starts switched off, which never clashes', () => {
    const rows = MEALS.map((m) => row(m, MEAL_HOURS[m]));
    expect(newPeriod(rows)).toMatchObject({ meal: 'Breakfast', active: false });
  });

  it('names each row by its meal, numbered only where two rows share one', () => {
    expect(periodNames([row('Lunch'), row('Dinner')])).toEqual(['Lunch', 'Dinner']);
    expect(periodNames([row('Dinner'), row('Lunch'), row('Dinner')])).toEqual(['Dinner 1', 'Lunch', 'Dinner 2']);
  });
});
