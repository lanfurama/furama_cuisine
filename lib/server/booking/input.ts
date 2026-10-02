import 'server-only';
import * as z from 'zod';
import type { BookingErrorCode } from '@/lib/booking-errors';
import { toE164 } from '@/lib/phone';
import { isValidIsoDate, type IsoDate } from '@/lib/venue-time';

/*
 * Step 2 of submitReservation (spec §10.2): the shape of what the reserve
 * drawer sends. It arrives over the wire, so nothing is trusted; a field that
 * fails maps to the error code the guest form already knows. Rules that need
 * the database (window, lead time, max_party, capacity) run later, in the
 * transaction, through resolveDay.
 */

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

const schema = z.object({
  restaurant: z.string().min(1).max(64),
  date: z.string().refine(isValidIsoDate),
  time: z.string().regex(HHMM),
  // No upper bound here: max_party decides, and answers party_too_large.
  guests: z.number().int().min(1),
  name: z.string().trim().min(2).max(120),
  /*
   * A pattern must never see unbounded input: this action is public and reads
   * up to Next's 1 MB body, and zod 4 runs a string's later checks after one
   * fails unless that check aborts. The email pattern is quadratic on a run of
   * '@' or '.' (40k characters take a second, 1 MB about ten minutes of a
   * blocked event loop), and any pattern of that shape is; only the length
   * bound fixes it, so the max aborts and the refine checks the length again.
   */
  phone: z
    .string()
    .trim()
    .max(40, { abort: true })
    .refine((p) => p.length <= 40 && p.replace(/\D/g, '').length >= 8),
  // The guest form's own check (lib/booking.ts validate), so the two agree.
  email: z
    .string()
    .trim()
    .max(254, { abort: true })
    .refine((e) => e === '' || (e.length <= 254 && /^\S+@\S+\.\S+$/.test(e))),
  note: z.string().trim().max(1000),
  /** The URL locale the guest booked in; unknown or disabled codes fall back to the default. */
  locale: z.string().max(35).optional(),
});

/** First failing field → the code the drawer shows. Order follows the form, top to bottom. */
const FIELD_CODES: [field: string, code: BookingErrorCode][] = [
  ['restaurant', 'restaurant_unavailable'],
  ['date', 'outside_window'],
  ['time', 'slot_unavailable'],
  ['guests', 'unknown'],
  ['name', 'invalid_name'],
  ['phone', 'invalid_phone'],
  ['email', 'invalid_email'],
  ['note', 'unknown'],
  ['locale', 'unknown'],
];

export type ReservationRequest = {
  restaurantId: string;
  date: IsoDate;
  time: string;
  guests: number;
  name: string;
  /** As the guest typed it. */
  phone: string;
  /** Canonical form; the duplicate check keys on it. */
  phoneE164: string;
  email: string | null;
  note: string | null;
  locale: string;
};

export type ParseResult = { ok: true; value: ReservationRequest } | { ok: false; code: BookingErrorCode };

export function parseReservationInput(input: unknown): ParseResult {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const failed = new Set(parsed.error.issues.map((i) => String(i.path[0])));
    return { ok: false, code: FIELD_CODES.find(([field]) => failed.has(field))?.[1] ?? 'unknown' };
  }
  const v = parsed.data;
  // Step 4: E.164, Vietnamese numbers by default.
  const phoneE164 = toE164(v.phone);
  if (!phoneE164) return { ok: false, code: 'invalid_phone' };
  return {
    ok: true,
    value: {
      restaurantId: v.restaurant,
      date: v.date,
      time: v.time,
      guests: v.guests,
      name: v.name,
      phone: v.phone,
      phoneE164,
      email: v.email || null,
      note: v.note || null,
      locale: v.locale ?? 'en',
    },
  };
}
