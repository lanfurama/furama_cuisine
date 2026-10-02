import type { Restaurant } from './data';
import { formatDay, type IsoDate } from './venue-time';

/*
 * The reservation form's own shapes and helpers. Availability (the window,
 * the lead time, the party limit, the slots and their covers) comes from the
 * server: GET /api/availability, read by lib/booking/client.ts.
 */

export type BookingForm = { name: string; phone: string; email: string; note: string };

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

export function validate(form: BookingForm) {
  return {
    name: form.name.trim().length >= 2,
    phone: form.phone.replace(/\D/g, '').length >= 8,
    email: !form.email.trim() || /^\S+@\S+\.\S+$/.test(form.email.trim()),
  };
}

export const guestLabel = (n: number) => `${n} ${n === 1 ? 'guest' : 'guests'}`;

/** Accent- and đ-insensitive fold, so "pho cuon" matches "Phố Cuốn". The SQL twin is fold_search() (migration 006). */
export const fold = (x: string) =>
  String(x)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');
