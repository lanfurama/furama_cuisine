import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPool } from '@/db/client';
import { findSlot, resolveDay } from '@/lib/booking/resolve-day';
import type { BookingRules, PeriodRule } from '@/lib/booking/rules';
import { SLOTS, type Meal } from '@/lib/data';
import { addDays, daysBetween, isoWeekday, minutesUntil, type IsoDate } from '@/lib/venue-time';

/*
 * Spec §10.1: migration 006 seeds service periods that reproduce the phase-1
 * behaviour exactly (global SLOTS × restaurants.meals × slot_capacity). The
 * phase-1 rule is written out here, from the raw restaurants columns, so the
 * comparison survives the removal of the phase-1 helpers (Task 6) and the
 * catalogue's switch to meals from periods (Task 5).
 */

/** Phase 1 (lib/booking.ts at 3c04ace): window 14 days, a sitting closes 30 minutes before, covers per slot. */
const PHASE1 = {
  inWindow: (date: IsoDate, today: IsoDate) => daysBetween(today, date) >= 0 && daysBetween(today, date) < 14,
  bookable: (date: IsoDate, time: string, guests: number, booked: Record<string, number>, capacity: number, now: Date) =>
    minutesUntil(date, time, now) > 30 && (booked[time] ?? 0) + guests <= capacity,
};

type Row = { id: string; name: string; destination: string; meals: Meal[]; slot_capacity: number; periods: PeriodRule[] };

const at = (danang: string) => new Date(`${danang}:00+07:00`);
const TODAY = '2026-10-01'; // a Thursday

describe.skipIf(!process.env.TEST_DATABASE_URL)('seeded service periods = phase-1 slots (database)', () => {
  let restaurants: Row[];
  const rules = new Map<string, BookingRules>();

  beforeAll(async () => {
    const settings = (await getPool().query('SELECT window_days, lead_minutes, same_day_cutoff, max_party FROM booking_settings')).rows[0];
    expect(settings).toEqual({ window_days: 14, lead_minutes: 30, same_day_cutoff: null, max_party: 12 });
    ({ rows: restaurants } = await getPool().query<Row>(
      `SELECT r.id, r.name, r.destination, r.meals, r.slot_capacity,
              COALESCE(json_agg(json_build_object(
                         'id', p.id::text, 'meal', p.meal, 'weekdays', p.weekdays,
                         'firstSeating', to_char(p.first_seating, 'HH24:MI'), 'lastSeating', to_char(p.last_seating, 'HH24:MI'),
                         'intervalMin', p.interval_min, 'coversPerSlot', p.covers_per_slot, 'sortOrder', p.sort_order)
                       ORDER BY p.sort_order) FILTER (WHERE p.id IS NOT NULL), '[]') AS periods
         FROM restaurants r LEFT JOIN service_periods p ON p.restaurant_id = r.id AND p.active
        GROUP BY r.id ORDER BY r.sort_order`,
    ));
    for (const r of restaurants) {
      rules.set(r.id, {
        restaurantId: r.id,
        restaurantName: r.name,
        destinationId: r.destination,
        bookingEnabled: true,
        windowDays: settings.window_days,
        leadMinutes: settings.lead_minutes,
        sameDayCutoff: null,
        maxParty: settings.max_party,
        autoConfirm: false,
        periods: r.periods,
        closures: [],
      });
    }
  });
  afterAll(() => getPool().end());

  it('seeds periods for all twelve restaurants', () => {
    expect(restaurants).toHaveLength(12);
    expect(restaurants.every((r) => r.periods.length === r.meals.length)).toBe(true);
  });

  it('offers the same meals, times and covers on every weekday', () => {
    const noon = at(`${TODAY}T12:00`);
    for (const r of restaurants) {
      const before = r.meals.flatMap((meal) => SLOTS[meal].map((t) => [meal, t, r.slot_capacity]));
      for (let i = 4; i < 11; i++) {
        const date = addDays(TODAY, i); // 5–11 Oct: Monday to Sunday
        const day = resolveDay(rules.get(r.id)!, date, noon);
        const after = day.periods.flatMap((p) => p.slots.map((s) => [p.meal, s.time, s.capacity]));
        expect({ restaurant: r.id, weekday: isoWeekday(date), slots: after }).toEqual({
          restaurant: r.id,
          weekday: isoWeekday(date),
          slots: before,
        });
      }
    }
  });

  it('agrees with phase 1 on which slots a party can book, sitting by sitting', () => {
    // Clock instants around the 30-minute lead of every service, a partly booked
    // board, and parties of 1, 4 and 12.
    const clocks = ['06:00', '06:59', '07:00', '11:00', '11:59', '13:00', '17:29', '17:30', '18:29', '18:30', '20:30', '21:31', '23:59'];
    const board = { '07:00': 39, '12:00': 15, '18:00': 10, '19:00': 16, '20:00': 59, '21:00': 1 };
    let compared = 0;
    for (const r of restaurants) {
      for (const clock of clocks) {
        const now = at(`${TODAY}T${clock}`);
        for (const date of [TODAY, addDays(TODAY, 1)]) {
          for (const guests of [1, 4, 12]) {
            const day = resolveDay(rules.get(r.id)!, date, now, board, guests);
            for (const meal of r.meals) {
              for (const time of SLOTS[meal]) {
                const before = PHASE1.bookable(date, time, guests, board, r.slot_capacity, now);
                expect({ r: r.id, clock, date, guests, time, bookable: findSlot(day, time)?.slot.bookable }).toEqual({
                  r: r.id, clock, date, guests, time, bookable: before,
                });
                compared++;
              }
            }
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(5000);
  });

  it('agrees with phase 1 on the 14-day window, across Da Nang midnight', () => {
    for (const instant of ['2026-10-01T16:59:00Z', '2026-10-01T17:00:00Z']) {
      const now = new Date(instant);
      const today = instant.startsWith('2026-10-01T16') ? '2026-10-01' : '2026-10-02';
      for (let i = -2; i < 17; i++) {
        const date = addDays('2026-10-01', i);
        const open = resolveDay(rules.get('taya-house')!, date, now).state !== 'outside';
        expect({ instant, date, open }).toEqual({ instant, date, open: PHASE1.inWindow(date, today) });
      }
    }
  });
});
