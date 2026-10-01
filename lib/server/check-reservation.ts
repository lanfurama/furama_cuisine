import 'server-only';
import type { Restaurant } from '@/lib/data';
import { MAX_GUESTS, inWindow, isSittingClosed, slotsFor, validate } from '@/lib/booking';
import type { BookingErrorCode } from '@/lib/booking-errors';
import { toE164 } from '@/lib/phone';
import { isValidIsoDate, venueNow, type IsoDate } from '@/lib/venue-time';

/** What the reserve drawer sends. It arrives over the wire, so nothing is trusted. */
export type ReservationInput = {
  restaurant: string;
  date: string;
  time: string;
  guests: number;
  name: string;
  phone: string;
  email: string;
  note: string;
};

export type CheckedReservation = {
  restaurant: Restaurant;
  date: IsoDate;
  time: string;
  guests: number;
  name: string;
  phone: string;
  phoneE164: string;
  email?: string;
  note?: string;
};

export type CheckResult =
  | { ok: true; value: CheckedReservation }
  | { ok: false; code: BookingErrorCode; params?: Record<string, string> };

/**
 * Re-checks everything the client claimed against the venue's clock: the
 * restaurant, the party size, the booking window, that the restaurant serves
 * that time, that the sitting has not closed, and the guest's details.
 */
export function checkReservation(
  input: ReservationInput,
  restaurants: Restaurant[],
  now: Date = new Date(),
): CheckResult {
  if (!input || typeof input !== 'object') return { ok: false, code: 'unknown' };

  const restaurant = restaurants.find((r) => r.id === input.restaurant);
  if (!restaurant) return { ok: false, code: 'restaurant_unavailable' };

  const guests = Number(input.guests);
  if (!Number.isInteger(guests) || guests < 1) return { ok: false, code: 'unknown' };
  if (guests > MAX_GUESTS) return { ok: false, code: 'party_too_large' };

  const date = String(input.date);
  if (!isValidIsoDate(date) || !inWindow(date, venueNow(now).date)) {
    return { ok: false, code: 'outside_window' };
  }

  const time = String(input.time);
  const served = slotsFor(restaurants, restaurant.id).some((g) => g.times.includes(time));
  if (!served) return { ok: false, code: 'slot_unavailable', params: { restaurant: restaurant.name } };
  if (isSittingClosed(date, time, now)) return { ok: false, code: 'past' };

  const name = String(input.name ?? '').trim();
  const phone = String(input.phone ?? '').trim();
  const email = String(input.email ?? '').trim();
  const note = String(input.note ?? '').trim();
  const checks = validate({ name, phone, email, note });
  if (!checks.name) return { ok: false, code: 'invalid_name' };
  const phoneE164 = toE164(phone);
  if (!checks.phone || !phoneE164) return { ok: false, code: 'invalid_phone' };
  if (!checks.email) return { ok: false, code: 'invalid_email' };

  return {
    ok: true,
    value: {
      restaurant,
      date,
      time,
      guests,
      name,
      phone,
      phoneE164,
      email: email || undefined,
      note: note || undefined,
    },
  };
}
