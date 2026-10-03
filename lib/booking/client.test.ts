import { describe, expect, it } from 'vitest';
import type { Booking } from '@/lib/booking';
import type { Restaurant } from '@/lib/data';
import {
  bookableRestaurants,
  bookingOpen,
  dateMove,
  dayReason,
  movedReason,
  reconcileBooking,
  type BookingContext,
} from './client';
import type { CalendarResponse, DayResponse } from './api';

const restaurant = (id: string, dest: Restaurant['dest'], bookingEnabled = true): Restaurant => ({
  id,
  slug: id,
  hasDetailPage: false,
  name: id,
  type: '',
  cuisines: [],
  dest,
  meals: ['Dinner'],
  bookingEnabled,
  image: null,
  phone: null,
  search: id,
});

const all = [
  restaurant('taya-house', 'resort'),
  restaurant('hai-van-lounge', 'resort', false),
  restaurant('the-fan', 'dining-house', false),
  restaurant('pho-cuon', 'dining-house'),
];
const restaurants = bookableRestaurants(all);
const at10 = new Date('2026-10-02T03:00:00Z'); // 10:00 on 2 Oct in Da Nang

const calendar: CalendarResponse = {
  restaurant: 'taya-house',
  today: '2026-10-02',
  now: at10.toISOString(),
  maxParty: 8,
  groupPhone: { display: '+84 236 651 9999', tel: '+842366519999' },
  days: [
    { date: '2026-10-02', state: 'open' },
    { date: '2026-10-03', state: 'closed', reason: 'Private event' },
    { date: '2026-10-04', state: 'open' },
  ],
};

const board: DayResponse = {
  restaurant: 'taya-house',
  today: '2026-10-02',
  now: at10.toISOString(),
  date: '2026-10-02',
  state: 'open',
  maxParty: 8,
  leadMinutes: 30,
  sameDayCutoff: null,
  periods: [
    {
      meal: 'Dinner',
      closed: false,
      slots: [
        { time: '18:00', left: 16, bookable: true },
        { time: '19:00', left: 2, bookable: true },
        { time: '20:00', left: 16, bookable: true },
      ],
    },
  ],
};

const booking: Booking = { destination: 'resort', restaurant: 'taya-house', date: '2026-10-02', time: '19:00', guests: 2 };
const ctx = (over: Partial<BookingContext> = {}): BookingContext => ({ restaurants, calendar, board, now: at10, ...over });

describe('reconcileBooking', () => {
  it('never chooses a restaurant that does not book online', () => {
    expect(reconcileBooking(booking, { restaurant: 'hai-van-lounge' }, ctx()).restaurant).toBe('taya-house');
  });

  it('picks the first bookable restaurant of a destination', () => {
    const next = reconcileBooking(booking, { destination: 'dining-house' }, ctx({ calendar: null, board: null }));
    expect(next).toMatchObject({ restaurant: 'pho-cuon', destination: 'dining-house' });
  });

  it('clamps the party to maxParty', () => {
    expect(reconcileBooking(booking, { guests: 9 }, ctx({ board: null })).guests).toBe(8);
  });

  it('refuses a date that is not open and keeps the current one', () => {
    expect(reconcileBooking(booking, { date: '2026-10-03' }, ctx({ board: null })).date).toBe('2026-10-02');
  });

  it('moves a date the calendar no longer offers to the first open day', () => {
    const stale = { ...booking, date: '2026-10-01' };
    expect(reconcileBooking(stale, {}, ctx({ board: null })).date).toBe('2026-10-02');
  });

  it('slides the time to the nearest slot with room for the party', () => {
    expect(reconcileBooking(booking, { guests: 4 }, ctx()).time).toBe('18:00');
  });

  it('ignores a board for another date', () => {
    const next = reconcileBooking({ ...booking, date: '2026-10-04' }, { guests: 4 }, ctx());
    expect(next.time).toBe('19:00');
  });
});

describe('reconcileBooking and stale answers', () => {
  it('ignores a calendar for another restaurant', () => {
    const other = { ...calendar, restaurant: 'pho-cuon' };
    expect(reconcileBooking(booking, { guests: 9, date: '2026-10-03' }, ctx({ calendar: other, board: null }))).toMatchObject({
      guests: 9,
      date: '2026-10-03',
    });
  });

  it('leaves the time alone when a meal is closed and nothing else is open', () => {
    const closedDinner: DayResponse = { ...board, periods: [{ meal: 'Dinner', closed: true, reason: 'Wedding', slots: [] }] };
    expect(reconcileBooking(booking, {}, ctx({ board: closedDinner })).time).toBe('19:00');
  });
});

describe('reconcileBooking on another restaurant’s calendar (a switch, GX-2)', () => {
  // Phở Cuốn: closed on the 4th, full on the 6th, and a shorter window (five days).
  const pho: CalendarResponse = {
    ...calendar,
    restaurant: 'pho-cuon',
    days: [
      { date: '2026-10-02', state: 'open' },
      { date: '2026-10-03', state: 'open' },
      { date: '2026-10-04', state: 'closed', reason: 'Closed on Sundays' },
      { date: '2026-10-05', state: 'open' },
      { date: '2026-10-06', state: 'full' },
    ],
  };
  const atPho: Booking = { ...booking, destination: 'dining-house', restaurant: 'pho-cuon' };
  const answer = (b: Booking) => reconcileBooking(b, {}, ctx({ calendar: pho, board: null }));

  it('moves a chosen future date the new calendar closes to the next open day after it, not back to today', () => {
    expect(answer({ ...atPho, date: '2026-10-04' }).date).toBe('2026-10-05');
  });

  it('moves a date beyond the new, shorter window to its last open day', () => {
    expect(answer({ ...atPho, date: '2026-10-12' }).date).toBe('2026-10-05');
  });

  it('still moves a stale past date to the first open day', () => {
    expect(answer({ ...atPho, date: '2026-10-01' }).date).toBe('2026-10-02');
  });

  describe('dateMove', () => {
    it('names the refused date, its day in the new calendar, and where the booking now is', () => {
      const before = { ...atPho, date: '2026-10-04' };
      expect(dateMove(before, answer(before), pho)).toEqual({
        restaurant: 'pho-cuon',
        from: '2026-10-04',
        to: '2026-10-05',
        day: { date: '2026-10-04', state: 'closed', reason: 'Closed on Sundays' },
      });
    });

    it('has no day for a date the calendar does not reach', () => {
      const before = { ...atPho, date: '2026-10-12' };
      expect(dateMove(before, answer(before), pho)).toEqual({ restaurant: 'pho-cuon', from: '2026-10-12', to: '2026-10-05', day: null });
    });

    it('is null when the date stays, and when the first date is set (no date before)', () => {
      expect(dateMove({ ...atPho, date: '2026-10-05' }, answer({ ...atPho, date: '2026-10-05' }), pho)).toBeNull();
      expect(dateMove({ ...atPho, date: '' }, answer({ ...atPho, date: '' }), pho)).toBeNull();
    });
  });

  describe('movedReason', () => {
    const words = {
      'booking.day_closed': 'Closed',
      'booking.day_full': 'Fully booked',
      'booking.day_past': 'No more tables today',
      'booking.day_outside': 'Not open for booking yet',
    };
    it('gives the day’s own reason, else says the date is beyond the window, or has passed', () => {
      const move = { restaurant: 'pho-cuon', from: '2026-10-04', to: '2026-10-05' } as const;
      expect(movedReason({ ...move, day: pho.days[2] }, pho.days, words)).toBe('Closed on Sundays');
      expect(movedReason({ ...move, from: '2026-10-12', day: null }, pho.days, words)).toBe('Not open for booking yet');
      expect(movedReason({ ...move, from: '2026-10-01', to: '2026-10-02', day: null }, pho.days, words)).toBe('No more tables today');
    });
  });
});

describe('bookingOpen', () => {
  it('is null without a board for the chosen day: the server decides', () => {
    expect(bookingOpen(ctx({ board: null }), booking)).toBeNull();
  });

  it('is false when the party no longer fits, or the clock closed the sitting by the board’s own rules', () => {
    expect(bookingOpen(ctx(), { ...booking, guests: 3 })).toBe(false);
    // 18:45: inside the 30-minute lead.
    expect(bookingOpen(ctx({ now: new Date('2026-10-02T11:45:00Z') }), booking)).toBe(false);
    // 17:00 with a 17:00 same-day cut-off from the server.
    expect(bookingOpen(ctx({ board: { ...board, sameDayCutoff: '17:00' }, now: new Date('2026-10-02T10:00:00Z') }), booking)).toBe(false);
    expect(bookingOpen(ctx(), booking)).toBe(true);
  });
});

describe('dayReason', () => {
  const words = { 'booking.day_closed': 'Closed', 'booking.day_full': 'Fully booked', 'booking.day_past': 'Too late' };
  it('prefers the public reason, else names the state', () => {
    expect(dayReason({ date: '2026-10-03', state: 'closed', reason: 'Private event' }, words)).toBe('Private event');
    expect(dayReason({ date: '2026-10-03', state: 'closed' }, words)).toBe('Closed');
    expect(dayReason({ date: '2026-10-03', state: 'full' }, words)).toBe('Fully booked');
  });
});
