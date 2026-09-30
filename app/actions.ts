'use server';

import { bookedCovers, createReservation, listRestaurants, slotCapacity } from '@/db/queries';
import { SLOTS, type Meal } from '@/lib/data';
import { DAY_COUNT, days, isoDate, isPast, newReference, validate } from '@/lib/booking';

export type ReservationInput = {
  restaurant: string;
  day: number;
  time: string;
  guests: number;
  name: string;
  phone: string;
  email: string;
  note: string;
};

export type ReservationResult =
  | { ok: true; reference: string; dateLabel: string }
  | { ok: false; error: string };

/**
 * Books a table. Everything the client claimed is re-checked here — the form
 * fields, that the slot belongs to the restaurant, that the date is inside the
 * booking window, and that the sitting has not already passed — before the
 * capacity-guarded insert runs.
 */
export async function submitReservation(input: ReservationInput): Promise<ReservationResult> {
  const restaurants = await listRestaurants();
  const restaurant = restaurants.find((r) => r.id === input.restaurant);
  if (!restaurant) return { ok: false, error: 'That restaurant is no longer available.' };

  const guests = Math.trunc(Number(input.guests));
  if (!Number.isFinite(guests) || guests < 1 || guests > 12) {
    return { ok: false, error: 'Please choose between 1 and 12 guests.' };
  }

  const day = Math.trunc(Number(input.day));
  if (!Number.isFinite(day) || day < 0 || day >= DAY_COUNT) {
    return { ok: false, error: 'Please choose a date within the next two weeks.' };
  }

  const servesSlot = (restaurant.meals as Meal[]).some((m) => SLOTS[m].includes(input.time));
  if (!servesSlot) {
    return { ok: false, error: `${restaurant.name} does not serve at that time.` };
  }

  if (isPast(day, input.time)) {
    return { ok: false, error: 'That sitting has already started — please pick a later time.' };
  }

  const checks = validate({
    name: input.name,
    phone: input.phone,
    email: input.email,
    note: input.note,
  });
  if (!checks.name) return { ok: false, error: 'Please enter your name.' };
  if (!checks.phone) return { ok: false, error: 'Please enter a valid phone number.' };
  if (!checks.email) return { ok: false, error: 'Please check your email address.' };

  const date = days()[day];
  const result = await createReservation({
    reference: newReference(),
    restaurantId: restaurant.id,
    isoDate: isoDate(date),
    time: input.time,
    guests,
    name: input.name.trim(),
    phone: input.phone.trim(),
    email: input.email.trim() || undefined,
    note: input.note.trim() || undefined,
  });

  if (!result.ok) {
    if (result.reason === 'full') {
      return { ok: false, error: 'That slot just filled up — please choose another time.' };
    }
    if (result.reason === 'duplicate') {
      return { ok: false, error: 'We already have a request for this table under your number.' };
    }
    return { ok: false, error: 'That restaurant is no longer available.' };
  }

  return {
    ok: true,
    reference: result.reference,
    dateLabel: isoDate(date),
  };
}

/** Live slot pressure for one restaurant on one day. */
export async function fetchAvailability(restaurantId: string, day: number) {
  const date = days()[Math.max(0, Math.min(DAY_COUNT - 1, day))];
  const [booked, capacity] = await Promise.all([
    bookedCovers(restaurantId, isoDate(date)),
    slotCapacity(restaurantId),
  ]);
  return { booked, capacity };
}
