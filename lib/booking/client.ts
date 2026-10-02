/**
 * The reservation form's rules in the browser, on top of what
 * /api/availability last said. Nothing here knows a slot list, a capacity,
 * a window or a party limit of its own: those all arrive from the server.
 */
import type { Booking } from '@/lib/booking';
import type { Restaurant } from '@/lib/data';
import { toMinutes, type IsoDate } from '@/lib/venue-time';
import type { CalendarResponse, DayInfo, DayResponse, PeriodInfo, SlotInfo } from './api';
import { clockBlock } from './resolve-day';

/** What the form knows right now. `restaurants` holds only those taking online bookings. */
export type BookingContext = {
  restaurants: Restaurant[];
  calendar: CalendarResponse | null;
  board: DayResponse | null;
  now: Date;
};

type DayWords = Record<'booking.day_closed' | 'booking.day_full' | 'booking.day_past', string>;

/** Why a day takes no bookings: its public reason, else the word for its state (registry booking.day_*). */
export function dayReason(d: DayInfo, words: DayWords): string {
  if (d.reason) return d.reason;
  if (d.state === 'full') return words['booking.day_full'];
  if (d.state === 'past') return words['booking.day_past'];
  return words['booking.day_closed'];
}

/** Restaurants guests can book online (restaurants.booking_enabled). */
export const bookableRestaurants = (restaurants: Restaurant[]) => restaurants.filter((r) => r.bookingEnabled);

/** The calendar, if it answers for this restaurant. */
export const calendarFor = (calendar: CalendarResponse | null, restaurant: string) =>
  calendar && calendar.restaurant === restaurant ? calendar : null;

/** The slot board, if it answers for this restaurant and date. */
export const boardFor = (board: DayResponse | null, restaurant: string, date: IsoDate | '') =>
  board && board.restaurant === restaurant && board.date === date ? board : null;

export const firstOpenDay = (days: DayInfo[]): IsoDate | '' => days.find((d) => d.state === 'open')?.date ?? '';

/** A slot the party can take now: open by the server, still open by the clock (the server's own rules), and with room. */
export function slotOpen(
  board: DayResponse,
  period: PeriodInfo,
  slot: SlotInfo,
  guests: number,
  now: Date,
): boolean {
  return (
    !period.closed &&
    slot.bookable &&
    slot.left >= guests &&
    guests <= board.maxParty &&
    clockBlock(board.date, slot.time, now, board) === null
  );
}

export function openTimes(board: DayResponse, guests: number, now: Date): string[] {
  return board.periods.flatMap((p) => p.slots.filter((s) => slotOpen(board, p, s, guests, now)).map((s) => s.time));
}

/** Keep the chosen time when it is still open; otherwise the nearest open one; otherwise leave it. */
export function nearestOpenTime(board: DayResponse, time: string, guests: number, now: Date): string {
  const open = openTimes(board, guests, now);
  if (!open.length || open.includes(time)) return time;
  const m = toMinutes(time);
  return open.reduce((a, x) => (Math.abs(toMinutes(x) - m) < Math.abs(toMinutes(a) - m) ? x : a), open[0]);
}

/**
 * Applies a change to the booking and keeps the rest consistent:
 * - a destination picks its first bookable restaurant; a restaurant implies its destination;
 * - a restaurant that does not book online is never chosen;
 * - with this restaurant's calendar: the party is clamped to maxParty, and a
 *   date that is not open (a closure, full, past, or outside the window) is
 *   refused, falling back to the first open day;
 * - with this day's board: the time slides to the nearest open slot.
 * Without the matching calendar or board those fields are left for the
 * server's answer to settle.
 */
export function reconcileBooking(current: Booking, patch: Partial<Booking>, ctx: BookingContext): Booking {
  const next = { ...current, ...patch };
  const { restaurants } = ctx;

  if (patch.destination && patch.destination !== current.destination && !patch.restaurant) {
    const first = restaurants.find((r) => r.dest === patch.destination);
    if (first) next.restaurant = first.id;
  }
  if (!restaurants.some((r) => r.id === next.restaurant)) {
    next.restaurant = restaurants.some((r) => r.id === current.restaurant)
      ? current.restaurant
      : (restaurants[0]?.id ?? '');
  }
  const r = restaurants.find((x) => x.id === next.restaurant);
  if (r) next.destination = r.dest;

  const calendar = calendarFor(ctx.calendar, next.restaurant);
  if (calendar) {
    next.guests = Math.max(1, Math.min(next.guests, calendar.maxParty));
    const isOpen = (d: IsoDate | '') => calendar.days.some((x) => x.date === d && x.state === 'open');
    if (!isOpen(next.date)) next.date = isOpen(current.date) ? current.date : firstOpenDay(calendar.days);
  }

  const board = boardFor(ctx.board, next.restaurant, next.date);
  if (board) next.time = nearestOpenTime(board, next.time, next.guests, ctx.now);
  return next;
}

/** The client gate before submitting: only with a board for this exact restaurant and date. */
export function bookingOpen(ctx: BookingContext, b: Booking): boolean | null {
  const board = boardFor(ctx.board, b.restaurant, b.date);
  if (!board) return null; // unknown: let the server decide
  return board.periods.some((p) => p.slots.some((s) => s.time === b.time && slotOpen(board, p, s, b.guests, ctx.now)));
}
