'use server';

import { createReservation, listRestaurants } from '@/db/queries';
import type { BookingErrorCode } from '@/lib/booking-errors';
import { checkReservation, type ReservationInput } from '@/lib/server/check-reservation';
import type { IsoDate } from '@/lib/venue-time';

export type ReservationResult =
  | { ok: true; data: { reference: string; date: IsoDate } }
  | { ok: false; code: BookingErrorCode; params?: Record<string, string> };

/**
 * Books a table. Everything the client claimed is re-checked against the
 * venue's clock (see checkReservation) before the capacity-guarded insert.
 * Failures come back as codes; the browser turns them into copy.
 */
export async function submitReservation(input: ReservationInput): Promise<ReservationResult> {
  const checked = checkReservation(input, await listRestaurants());
  if (!checked.ok) return checked;

  const v = checked.value;
  const result = await createReservation({
    restaurantId: v.restaurant.id,
    isoDate: v.date,
    time: v.time,
    guests: v.guests,
    name: v.name,
    phone: v.phone,
    phoneE164: v.phoneE164,
    email: v.email,
    note: v.note,
  });

  if (result.ok) return { ok: true, data: { reference: result.reference, date: v.date } };
  if (result.reason === 'full') return { ok: false, code: 'full' };
  if (result.reason === 'duplicate') return { ok: false, code: 'duplicate' };
  return { ok: false, code: 'restaurant_unavailable' };
}
