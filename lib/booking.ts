import type { Restaurant } from './data';
import { formatDay, type IsoDate } from './venue-time';

/*
 * The reservation form's own shapes and helpers. Availability (the window,
 * the lead time, the party limit, the slots and their covers) comes from the
 * server: GET /api/availability, read by lib/booking/client.ts.
 */

export type BookingForm = { name: string; phone: string; email: string; note: string };

/**
 * The longest value each field may hold. lib/server/booking/input.ts refuses
 * anything longer (a note answers 'unknown', which no retry can fix), so the
 * drawer stops typing there; lib/booking.test.ts pins the two together.
 */
export const FIELD_MAX: Record<keyof BookingForm, number> = { name: 120, phone: 40, email: 254, note: 1000 };

export type Booking = {
  destination: string;
  restaurant: string;
  /** Da Nang calendar date; empty until the server's calendar has answered. */
  date: IsoDate | '';
  time: string;
  guests: number;
};

/** "Thu, 1 Oct". */
export const fmtDay = (d: IsoDate) => formatDay(d).label;

export const findRestaurant = (restaurants: Restaurant[], id: string) =>
  restaurants.find((r) => r.id === id);

/**
 * One "@" in an email (R13), as lib/server/booking/input.ts checks it: the
 * outbox stores only such an address, so a guest is never told a booking went
 * through with an address no email can reach.
 */
export const GUEST_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validate(form: BookingForm) {
  return {
    name: form.name.trim().length >= 2,
    phone: form.phone.replace(/\D/g, '').length >= 8,
    email: !form.email.trim() || GUEST_EMAIL.test(form.email.trim()),
  };
}

/** Accent- and đ-insensitive fold, so "pho cuon" matches "Phố Cuốn". The SQL twin is fold_search() (migration 006). */
export const fold = (x: string) =>
  String(x)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');
