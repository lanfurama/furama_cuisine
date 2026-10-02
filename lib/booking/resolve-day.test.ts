import { describe, expect, it } from 'vitest';
import { clockBlock, findPlannedSlot, findSlot, planDay, resolveDay, resolveRange, seatings } from './resolve-day';
import type { BookingRules, ClosureRule, PeriodRule } from './rules';

// 2026-10-01 is a Thursday. The runner is pinned to UTC (npm test sets TZ=UTC);
// Da Nang is UTC+7, so these instants are Da Nang wall-clock times.
const at = (danang: string) => new Date(`${danang}:00+07:00`);

const period = (over: Partial<PeriodRule> = {}): PeriodRule => ({
  id: 'p-dinner',
  meal: 'Dinner',
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  firstSeating: '18:00',
  lastSeating: '21:00',
  intervalMin: 30,
  coversPerSlot: 16,
  sortOrder: 40,
  ...over,
});

const LUNCH = period({ id: 'p-lunch', meal: 'Lunch', firstSeating: '11:30', lastSeating: '13:30', sortOrder: 20 });
const BREAKFAST = period({ id: 'p-bf', meal: 'Breakfast', firstSeating: '06:30', lastSeating: '09:30', sortOrder: 10 });

const rules = (over: Partial<BookingRules> = {}): BookingRules => ({
  restaurantId: 'taya-house',
  restaurantName: 'Tàya House',
  destinationId: 'resort',
  bookingEnabled: true,
  windowDays: 14,
  leadMinutes: 30,
  sameDayCutoff: null,
  maxParty: 12,
  autoConfirm: false,
  periods: [LUNCH, period()],
  closures: [],
  ...over,
});

const closure = (over: Partial<ClosureRule> = {}): ClosureRule => ({
  id: 'c1',
  scope: 'restaurant',
  destinationId: null,
  restaurantId: 'taya-house',
  startsOn: '2026-10-05',
  endsOn: '2026-10-05',
  meals: null,
  publicReason: 'Private event',
  ...over,
});

const NOON_OCT_1 = at('2026-10-01T12:00');
const times = (day: ReturnType<typeof resolveDay>) => day.periods.flatMap((p) => p.slots.map((s) => s.time));

describe('seatings', () => {
  it('runs from the first to the last seating by the interval', () => {
    expect(seatings(period())).toEqual(['18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00']);
    expect(seatings({ firstSeating: '17:00', lastSeating: '22:00', intervalMin: 60 })).toEqual([
      '17:00', '18:00', '19:00', '20:00', '21:00', '22:00',
    ]);
    expect(seatings({ firstSeating: '23:30', lastSeating: '23:59', intervalMin: 15 })).toEqual(['23:30', '23:45']);
  });
});

describe('planDay (staff paths: no clock, no window, no booking switch)', () => {
  it('lists the services of any date, even one past the window or with booking off', () => {
    const plan = planDay(rules({ bookingEnabled: false, windowDays: 1 }), '2026-12-01');
    expect(plan.periods.map((p) => [p.meal, p.closed, p.slots.length])).toEqual([
      ['Lunch', false, 5],
      ['Dinner', false, 7],
    ]);
    expect(plan.periods[1].slots[0]).toEqual({ time: '18:00', capacity: 16 });
  });

  it('marks the services a closure takes out, with the whole-day reason', () => {
    const plan = planDay(rules({ closures: [closure()] }), '2026-10-05');
    expect(plan.wholeDayReason).toBe('Private event');
    expect(plan.periods.map((p) => [p.meal, p.closed])).toEqual([
      ['Lunch', true],
      ['Dinner', true],
    ]);
  });

  it('finds the service and capacity of a time, closed or not; nothing for a time off the grid', () => {
    const plan = planDay(rules({ closures: [closure({ meals: ['Dinner'] })] }), '2026-10-05');
    expect(findPlannedSlot(plan, '12:00')).toMatchObject({ period: { meal: 'Lunch', closed: false }, capacity: 16 });
    expect(findPlannedSlot(plan, '19:00')).toMatchObject({ period: { meal: 'Dinner', closed: true }, capacity: 16 });
    expect(findPlannedSlot(plan, '19:15')).toBeNull();
    expect(findPlannedSlot(planDay(rules({ periods: [] }), '2026-10-05'), '19:00')).toBeNull();
  });
});

describe('resolveDay: periods', () => {
  it('lists each active period of that weekday with covers_per_slot per slot', () => {
    const day = resolveDay(rules(), '2026-10-05', NOON_OCT_1);
    expect(day.state).toBe('open');
    expect(day.periods.map((p) => p.meal)).toEqual(['Lunch', 'Dinner']);
    expect(day.periods[1].slots[0]).toEqual({ time: '18:00', capacity: 16, booked: 0, left: 16, bookable: true });
  });

  it('serves a period only on its weekdays', () => {
    const weekdaysOnly = rules({ periods: [period({ weekdays: [1, 2, 3, 4, 5] })] });
    expect(resolveDay(weekdaysOnly, '2026-10-05', NOON_OCT_1).state).toBe('open'); // Monday
    expect(resolveDay(weekdaysOnly, '2026-10-03', NOON_OCT_1)).toEqual({
      date: '2026-10-03', state: 'closed', reason: null, periods: [],
    }); // Saturday
  });

  it('ignores inactive periods', () => {
    const day = resolveDay(rules({ periods: [LUNCH, period({ active: false })] }), '2026-10-05', NOON_OCT_1);
    expect(day.periods.map((p) => p.meal)).toEqual(['Lunch']);
  });

  it('orders periods by sort order, then first seating', () => {
    const day = resolveDay(rules({ periods: [period(), BREAKFAST, LUNCH] }), '2026-10-05', NOON_OCT_1);
    expect(day.periods.map((p) => p.meal)).toEqual(['Breakfast', 'Lunch', 'Dinner']);
  });

  it('keeps a time once when two periods overlap: the first by sort order owns it', () => {
    const drinks = period({ id: 'p-drinks', meal: 'Drinks', firstSeating: '17:00', lastSeating: '22:00', intervalMin: 60, sortOrder: 30, coversPerSlot: 24 });
    const day = resolveDay(rules({ periods: [period(), drinks] }), '2026-10-05', NOON_OCT_1);
    expect(times(day)).toEqual(['17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '18:30', '19:30', '20:30']);
    expect(findSlot(day, '19:00')?.period.meal).toBe('Drinks');
  });
});

describe('resolveDay: closures', () => {
  it('closes the whole day and shows the public reason', () => {
    const day = resolveDay(rules({ closures: [closure()] }), '2026-10-05', NOON_OCT_1);
    expect(day.state).toBe('closed');
    expect(day.reason).toBe('Private event');
    expect(day.periods.every((p) => p.closed && p.slots.every((s) => s.block === 'closed'))).toBe(true);
  });

  it('includes both ends of the date range', () => {
    const c = closure({ startsOn: '2026-10-05', endsOn: '2026-10-07' });
    const state = (d: string) => resolveDay(rules({ closures: [c] }), d, NOON_OCT_1).state;
    expect([state('2026-10-04'), state('2026-10-05'), state('2026-10-07'), state('2026-10-08')]).toEqual([
      'open', 'closed', 'closed', 'open',
    ]);
  });

  it('matches scope all, the restaurant’s destination, or the restaurant itself', () => {
    const state = (c: ClosureRule) => resolveDay(rules({ closures: [c] }), '2026-10-05', NOON_OCT_1).state;
    expect(state(closure({ scope: 'all', restaurantId: null }))).toBe('closed');
    expect(state(closure({ scope: 'destination', restaurantId: null, destinationId: 'resort' }))).toBe('closed');
    expect(state(closure({ scope: 'destination', restaurantId: null, destinationId: 'dining-house' }))).toBe('open');
    expect(state(closure({ restaurantId: 'pho-cuon' }))).toBe('open');
  });

  it('closes only the listed meals; the others stay bookable', () => {
    const day = resolveDay(rules({ closures: [closure({ meals: ['Dinner'], publicReason: 'Wedding' })] }), '2026-10-05', NOON_OCT_1);
    expect(day.state).toBe('open');
    expect(day.periods.map((p) => [p.meal, p.closed, p.reason])).toEqual([
      ['Lunch', false, null],
      ['Dinner', true, 'Wedding'],
    ]);
    expect(findSlot(day, '19:00')?.slot).toMatchObject({ bookable: false, block: 'closed' });
    expect(findSlot(day, '12:00')?.slot.bookable).toBe(true);
  });

  it('closes the day when closures take out every service it has', () => {
    const day = resolveDay(rules({ closures: [closure({ meals: ['Lunch', 'Dinner'] })] }), '2026-10-05', NOON_OCT_1);
    expect(day).toMatchObject({ state: 'closed', reason: 'Private event' });
  });

  it('closes without a reason when the closure hides it', () => {
    const day = resolveDay(rules({ closures: [closure({ publicReason: null })] }), '2026-10-05', NOON_OCT_1);
    expect(day).toMatchObject({ state: 'closed', reason: null });
  });
});

describe('resolveDay: window', () => {
  it('offers today through today + window_days − 1', () => {
    const state = (d: string) => resolveDay(rules(), d, NOON_OCT_1).state;
    expect(state('2026-09-30')).toBe('outside');
    expect(state('2026-10-01')).toBe('open');
    expect(state('2026-10-14')).toBe('open');
    expect(state('2026-10-15')).toBe('outside');
    expect(resolveDay(rules({ windowDays: 1 }), '2026-10-02', NOON_OCT_1).state).toBe('outside');
  });

  it("moves the window at Da Nang's midnight, not the server's", () => {
    const before = new Date('2026-10-01T16:59:00Z'); // 23:59 on 1 Oct in Da Nang
    const after = new Date('2026-10-01T17:00:00Z'); //  00:00 on 2 Oct in Da Nang
    expect(resolveDay(rules(), '2026-10-15', before).state).toBe('outside');
    expect(resolveDay(rules(), '2026-10-15', after).state).toBe('open');
    expect(resolveDay(rules(), '2026-10-01', after).state).toBe('outside');
  });
});

describe('resolveDay: lead time', () => {
  const dinnerAt = (now: Date, lead = 30) => findSlot(resolveDay(rules({ leadMinutes: lead }), '2026-10-01', now), '19:00')?.slot;

  it('needs more than lead_minutes on the clock minute: 18:29 books 19:00, 18:30 does not', () => {
    expect(dinnerAt(at('2026-10-01T18:29'))).toMatchObject({ bookable: true });
    expect(dinnerAt(at('2026-10-01T18:30'))).toMatchObject({ bookable: false, block: 'lead' });
    // 18:30:59 is still minute 18:30 (29 min 1 s left).
    expect(dinnerAt(new Date('2026-10-01T18:30:59+07:00'))).toMatchObject({ block: 'lead' });
  });

  it('with no lead time closes a sitting when it starts', () => {
    expect(dinnerAt(at('2026-10-01T18:59'), 0)).toMatchObject({ bookable: true });
    expect(dinnerAt(at('2026-10-01T19:00'), 0)).toMatchObject({ block: 'lead' });
  });

  it('counts across Da Nang midnight', () => {
    // 23:45 on 1 Oct; breakfast 06:30 on 2 Oct is 405 minutes away.
    const late = at('2026-10-01T23:45');
    const slot = (lead: number) =>
      findSlot(resolveDay(rules({ leadMinutes: lead, periods: [BREAKFAST] }), '2026-10-02', late), '06:30')?.slot;
    expect(slot(404)).toMatchObject({ bookable: true });
    expect(slot(405)).toMatchObject({ block: 'lead' });
  });

  it('reports past once every remaining sitting today is inside the lead time', () => {
    expect(resolveDay(rules(), '2026-10-01', at('2026-10-01T20:30')).state).toBe('past');
    expect(resolveDay(rules(), '2026-10-01', at('2026-10-01T20:29')).state).toBe('open');
  });
});

describe('clockBlock (the guest form closes sittings with the same rule)', () => {
  const r = { leadMinutes: 30, sameDayCutoff: '17:00' };

  it('blocks inside the lead time first, then from the same-day cut-off', () => {
    expect(clockBlock('2026-10-01', '19:00', at('2026-10-01T16:59'), r)).toBeNull();
    expect(clockBlock('2026-10-01', '19:00', at('2026-10-01T17:00'), r)).toBe('cutoff');
    expect(clockBlock('2026-10-01', '17:20', at('2026-10-01T17:00'), r)).toBe('lead');
    expect(clockBlock('2026-10-01', '19:00', at('2026-10-01T18:30'), { leadMinutes: 30, sameDayCutoff: null })).toBe('lead');
  });

  it('applies the cut-off to today only', () => {
    expect(clockBlock('2026-10-02', '12:00', at('2026-10-01T23:00'), r)).toBeNull();
  });
});

describe('resolveDay: same-day cut-off', () => {
  const r = rules({ sameDayCutoff: '17:00' });

  it('stops same-day booking from the cut-off minute', () => {
    expect(resolveDay(r, '2026-10-01', at('2026-10-01T16:59')).state).toBe('open');
    const day = resolveDay(r, '2026-10-01', at('2026-10-01T17:00'));
    expect(day.state).toBe('past');
    expect(findSlot(day, '20:00')?.slot.block).toBe('cutoff');
  });

  it('leaves tomorrow alone', () => {
    expect(resolveDay(r, '2026-10-02', at('2026-10-01T23:00')).state).toBe('open');
  });
});

describe('resolveDay: capacity and party size', () => {
  it('books a slot while booked + party ≤ covers_per_slot', () => {
    const day = (guests: number) => resolveDay(rules(), '2026-10-05', NOON_OCT_1, { '19:00': 14 }, guests);
    expect(findSlot(day(2), '19:00')?.slot).toEqual({ time: '19:00', capacity: 16, booked: 14, left: 2, bookable: true });
    expect(findSlot(day(3), '19:00')?.slot).toMatchObject({ left: 2, bookable: false, block: 'full' });
  });

  it('never reports negative covers left (staff may book over capacity)', () => {
    const day = resolveDay(rules(), '2026-10-05', NOON_OCT_1, { '19:00': 20 });
    expect(findSlot(day, '19:00')?.slot).toMatchObject({ booked: 20, left: 0, block: 'full' });
  });

  it('is full when no remaining sitting has room', () => {
    const booked = Object.fromEntries(times(resolveDay(rules(), '2026-10-05', NOON_OCT_1)).map((t) => [t, 16]));
    expect(resolveDay(rules(), '2026-10-05', NOON_OCT_1, booked).state).toBe('full');
  });

  it('is full, not past, when the sittings left today are taken', () => {
    const day = resolveDay(rules(), '2026-10-01', at('2026-10-01T20:00'), { '21:00': 16 });
    expect(day.state).toBe('full');
  });

  it('refuses a party above max_party', () => {
    expect(resolveDay(rules({ maxParty: 8 }), '2026-10-05', NOON_OCT_1, {}, 8).state).toBe('open');
    const day = resolveDay(rules({ maxParty: 8 }), '2026-10-05', NOON_OCT_1, {}, 9);
    expect(day.state).toBe('too_large');
    expect(findSlot(day, '19:00')?.slot.block).toBe('party');
  });

  it('is unavailable when online booking is off', () => {
    expect(resolveDay(rules({ bookingEnabled: false }), '2026-10-05', NOON_OCT_1)).toEqual({
      date: '2026-10-05', state: 'unavailable', reason: null, periods: [],
    });
  });
});

describe('resolveRange', () => {
  it('gives one state per date, with the closure reason when shown', () => {
    const r = rules({ closures: [closure()], windowDays: 5 });
    expect(resolveRange(r, '2026-10-01', '2026-10-06', at('2026-10-01T20:45'), { '2026-10-02': {} })).toEqual([
      { date: '2026-10-01', state: 'past' },
      { date: '2026-10-02', state: 'open' },
      { date: '2026-10-03', state: 'open' },
      { date: '2026-10-04', state: 'open' },
      { date: '2026-10-05', state: 'closed', reason: 'Private event' },
      { date: '2026-10-06', state: 'outside' },
    ]);
  });
});
