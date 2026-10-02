'use server';

import type { BookingErrorCode } from '@/lib/booking-errors';
import { createWebReservation } from '@/lib/server/booking/create';
import { honeypotFilled, parseReservationInput } from '@/lib/server/booking/input';
import { drainAfterCommit } from '@/lib/server/email/after-commit';
import type { IsoDate } from '@/lib/venue-time';

export type ReservationResult =
  | { ok: true; data: { reference: string; date: IsoDate; status: 'requested' | 'confirmed' } }
  | { ok: false; code: BookingErrorCode; params?: Record<string, string> };

/**
 * Books a table (spec §10.2). Step 1 refuses a bot before anything else runs:
 * the honeypot (free; BotID joins it in phase 5's BotID task). Then zod
 * (step 2, consent included), and one locked transaction for the per-phone
 * limit, the clock and rule checks, the insert and its outbox rows (steps
 * 3–6), and after() once it has committed (step 7). Failures come back as
 * codes; the browser turns them into copy. A database error throws, so the
 * guest sees error.network (spec §12).
 */
export async function submitReservation(input: unknown): Promise<ReservationResult> {
  if (honeypotFilled(input)) {
    // No guest data in the log (spec §12): only which check refused.
    console.warn('[booking] refused as a bot', { by: 'honeypot' });
    return { ok: false, code: 'bot_blocked' };
  }
  const parsed = parseReservationInput(input);
  if (!parsed.ok) return parsed;
  const result = await createWebReservation(parsed.value);
  if (!result.ok) return result;
  // Step 7: the booking has committed; its emails go out after the response (a failed send never fails the booking, spec §12).
  drainAfterCommit(result.outboxIds);
  return { ok: true, data: { reference: result.reference, date: result.date, status: result.status } };
}
