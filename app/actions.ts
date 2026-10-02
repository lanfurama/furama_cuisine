'use server';

import type { BookingErrorCode } from '@/lib/booking-errors';
import { createWebReservation } from '@/lib/server/booking/create';
import { parseReservationInput } from '@/lib/server/booking/input';
import type { IsoDate } from '@/lib/venue-time';

export type ReservationResult =
  | { ok: true; data: { reference: string; date: IsoDate; status: 'requested' | 'confirmed' } }
  | { ok: false; code: BookingErrorCode; params?: Record<string, string> };

/**
 * Books a table (spec §10.2, steps 2, 3, 4, 6 and 7; BotID, the honeypot, the
 * phone limit and the outbox arrive in phase 5). Everything the client claimed
 * is parsed with zod, then re-checked against the venue's clock and the live
 * rules inside one locked transaction. Failures come back as codes; the
 * browser turns them into copy. A database error throws, so the guest sees
 * error.network (spec §12).
 */
export async function submitReservation(input: unknown): Promise<ReservationResult> {
  const parsed = parseReservationInput(input);
  if (!parsed.ok) return parsed;
  const result = await createWebReservation(parsed.value);
  if (!result.ok) return result;
  return { ok: true, data: { reference: result.reference, date: result.date, status: result.status } };
}
