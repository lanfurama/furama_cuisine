import 'server-only';
import * as z from 'zod';
import { GUEST_EMAIL } from '@/lib/booking';
import type { BookingErrorCode } from '@/lib/booking-errors';
import { PRIVACY_POLICY_VERSION } from '@/lib/legal';
import { toE164 } from '@/lib/phone';
import { isValidIsoDate, type IsoDate } from '@/lib/venue-time';

/*
 * Step 2 of submitReservation (spec §10.2): the shape of what the reserve
 * drawer sends, the consent box included (spec §11). It arrives over the wire, so nothing is trusted; a field that
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
  // The guest form's own check (lib/booking.ts validate), so the two agree: one "@" (R13).
  email: z
    .string()
    .trim()
    .max(254, { abort: true })
    .refine((e) => e === '' || (e.length <= 254 && GUEST_EMAIL.test(e))),
  note: z.string().trim().max(1000),
  /** The URL locale the guest booked in; unknown or disabled codes fall back to the default. */
  locale: z.string().max(35).optional(),
  /** The privacy consent box (spec §11): only a ticked box books. */
  consent: z.literal(true),
  /** The drawer's hidden field; step 1 (honeypotFilled) has already refused anything but empty. */
  honeypot: z.literal('').optional(),
  /**
   * offers.id of the VIEW OFFER the form was opened from. A soft link (R9): a
   * value that is not a positive int4 is dropped, never an error, since the
   * booking stands without it; the insert keeps only an offer of this
   * restaurant that runs on the booked date.
   */
  offerId: z.number().int().positive().max(2_147_483_647).optional().catch(undefined),
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
  ['consent', 'consent_required'],
  ['locale', 'unknown'],
  ['honeypot', 'bot_blocked'],
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
  /** The privacy policy version the guest agreed to (lib/legal.ts), stored on the booking. */
  consentVersion: string;
  /** The offer as sent (R9); reservations.offer_id gets it only if the insert's check passes. */
  offerId: number | null;
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
      // The version this server shows; the box links to that page.
      consentVersion: PRIVACY_POLICY_VERSION,
      offerId: v.offerId ?? null,
    },
  };
}

/**
 * Step 1 of submitReservation, before zod: the drawer's hidden field
 * (components/overlays/Honeypot.tsx) came back with something in it. People
 * never see or reach it, so any value at all (even spaces) means a script
 * filled every field it found.
 */
export function honeypotFilled(input: unknown): boolean {
  if (typeof input !== 'object' || input === null || !('honeypot' in input)) return false;
  const value = (input as { honeypot: unknown }).honeypot;
  return value !== undefined && value !== null && value !== '';
}
