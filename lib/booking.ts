import { MO, SLOTS, WD, type Meal, type Restaurant } from './data';
import { addDays, daysBetween, minutesUntil, type IsoDate } from './venue-time';

export type BookingForm = { name: string; phone: string; email: string; note: string };

export type Booking = {
  destination: string;
  restaurant: string;
  /** Offset in days from today, 0–13. */
  day: number;
  time: string;
  guests: number;
};

/** Covers already booked per slot, plus the room each slot has. From Neon. */
export type Availability = { booked: Record<string, number>; capacity: number };

export const NO_AVAILABILITY: Availability = { booked: {}, capacity: Number.POSITIVE_INFINITY };

export const DAY_COUNT = 14;

/** Online booking window: today plus the next 13 days, in Da Nang time. */
export const BOOKING_WINDOW_DAYS = 14;
/** A sitting closes to online booking this many minutes before it starts. */
export const LEAD_MINUTES = 30;
export const MAX_GUESTS = 12;

/** The dates a guest can pick, starting with the venue's today. */
export function bookingDates(today: IsoDate): IsoDate[] {
  return Array.from({ length: BOOKING_WINDOW_DAYS }, (_, i) => addDays(today, i));
}

export function inWindow(date: IsoDate, today: IsoDate): boolean {
  const offset = daysBetween(today, date);
  return offset >= 0 && offset < BOOKING_WINDOW_DAYS;
}

/** True once a sitting is within LEAD_MINUTES of starting, in Da Nang time. */
export function isSittingClosed(date: IsoDate, time: string, now: Date = new Date()): boolean {
  return minutesUntil(date, time, now) <= LEAD_MINUTES;
}

/** The next 14 days, starting today at midnight. */
export function days(from: Date = new Date()): Date[] {
  const base = new Date(from);
  base.setHours(0, 0, 0, 0);
  return Array.from({ length: DAY_COUNT }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    return d;
  });
}

export const fmtDay = (d: Date) => `${WD[d.getDay()]}, ${d.getDate()} ${MO[d.getMonth()]}`;

/** Local calendar date as YYYY-MM-DD — never UTC, so "today" matches the guest's day. */
export function isoDate(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export const toMin = (t: string) => parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(3), 10);

export const findRestaurant = (restaurants: Restaurant[], id: string) =>
  restaurants.find((r) => r.id === id);

export function slotsFor(
  restaurants: Restaurant[],
  restaurantId: string,
): { meal: Meal; times: string[] }[] {
  const r = findRestaurant(restaurants, restaurantId);
  const meals: Meal[] = r ? r.meals : ['Dinner'];
  return meals.map((meal) => ({ meal, times: SLOTS[meal] }));
}

/** Today, unless every sitting of the restaurant has already closed for today. */
export function defaultDate(
  restaurants: Restaurant[],
  restaurantId: string,
  today: IsoDate,
  now: Date = new Date(),
): IsoDate {
  const open = slotsFor(restaurants, restaurantId).some((g) =>
    g.times.some((t) => !isSittingClosed(today, t, now)),
  );
  return open ? today : addDays(today, 1);
}

/** Today's slots stop being bookable 30 minutes ahead of the sitting. */
export function isPast(day: number, time: string, now: Date = new Date()): boolean {
  return day === 0 && toMin(time) <= now.getHours() * 60 + now.getMinutes() + 30;
}

/** A slot is closed when it has passed, or when the party would exceed its remaining covers. */
export function unavailable(
  day: number,
  time: string,
  guests: number,
  availability: Availability,
  now?: Date,
): boolean {
  if (isPast(day, time, now)) return true;
  const taken = availability.booked[time] ?? 0;
  return taken + guests > availability.capacity;
}

export function seatsLeft(time: string, availability: Availability): number | null {
  if (!Number.isFinite(availability.capacity)) return null;
  return Math.max(0, availability.capacity - (availability.booked[time] ?? 0));
}

/** Keep the chosen time valid: fall back to the nearest open slot. */
export function normTime(
  restaurants: Restaurant[],
  b: Booking,
  availability: Availability,
  now?: Date,
): string {
  const open: string[] = [];
  for (const g of slotsFor(restaurants, b.restaurant)) {
    for (const t of g.times) if (!unavailable(b.day, t, b.guests, availability, now)) open.push(t);
  }
  if (!open.length || open.includes(b.time)) return b.time;
  const m = toMin(b.time);
  return open.reduce((a, x) => (Math.abs(toMin(x) - m) < Math.abs(toMin(a) - m) ? x : a), open[0]);
}

/**
 * Reconcile a patch against the rest of the booking: a restaurant implies its
 * destination, switching destination picks that venue's first restaurant, and
 * the chosen time is nudged to something still bookable.
 */
export function reconcile(
  restaurants: Restaurant[],
  current: Booking,
  patch: Partial<Booking>,
  availability: Availability = NO_AVAILABILITY,
  now?: Date,
): Booking {
  const next = { ...current, ...patch };

  if (patch.destination && patch.destination !== current.destination && !patch.restaurant) {
    const first = restaurants.find((r) => r.dest === patch.destination);
    if (first) next.restaurant = first.id;
  }

  const r = findRestaurant(restaurants, next.restaurant);
  if (r) next.destination = r.dest;

  next.time = normTime(restaurants, next, availability, now);
  return next;
}

export function validate(form: BookingForm) {
  return {
    name: form.name.trim().length >= 2,
    phone: form.phone.replace(/\D/g, '').length >= 8,
    email: !form.email.trim() || /^\S+@\S+\.\S+$/.test(form.email.trim()),
  };
}

export function slotBookable(
  restaurants: Restaurant[],
  b: Booking,
  availability: Availability,
  now?: Date,
): boolean {
  return (
    !unavailable(b.day, b.time, b.guests, availability, now) &&
    slotsFor(restaurants, b.restaurant).some((g) => g.times.includes(b.time))
  );
}

export const guestLabel = (n: number) => `${n} ${n === 1 ? 'guest' : 'guests'}`;

/** Accent- and đ-insensitive fold, so "pho cuon" matches "Phố Cuốn". */
export const fold = (x: string) =>
  String(x)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');
