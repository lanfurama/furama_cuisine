'use server';

import type { BookingErrorCode } from '@/lib/booking-errors';
import { createWebReservation } from '@/lib/server/booking/create';
import { honeypotFilled, parseReservationInput } from '@/lib/server/booking/input';
import { drainAfterCommit } from '@/lib/server/email/after-commit';
import { isBotRequest } from '@/lib/server/guard/bot';
import type { IsoDate } from '@/lib/venue-time';

export type ReservationResult =
  | { ok: true; data: { reference: string; date: IsoDate; status: 'requested' | 'confirmed' } }
  | { ok: false; code: BookingErrorCode; params?: Record<string, string> };

/**
 * Books a table (spec §10.2). Step 1 refuses a bot before anything else runs:
 * the honeypot first (free), then BotID (a call to Vercel, on a deployment
 * only). Then zod (step 2, consent included), and one locked transaction for
 * the per-phone limit, the clock and rule checks, the insert and its outbox
 * rows (steps 3–6), and after() once it has committed (step 7). Failures come
 * back as codes; the browser turns them into copy. A database error throws,
 * so the guest sees error.network (spec §12).
 */
export async function submitReservation(input: unknown): Promise<ReservationResult> {
  const blockedBy = honeypotFilled(input) ? 'honeypot' : (await isBotRequest()) ? 'botid' : null;
  if (blockedBy) {
    // No guest data in the log (spec §12): only which check refused.
    console.warn('[booking] refused as a bot', { by: blockedBy });
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
