/**
 * What can go wrong with a table request. The server returns only these
 * codes; the browser turns them into copy. The copy lives in the content
 * registry (lib/i18n/registry.ts) as error.<code>, so the DB can override it.
 */
import { PHONE_DAY_LIMIT, type GroupPhone } from '@/lib/booking/rules';
import { FALLBACK_PHONE } from '@/lib/data';
import { formatMessage } from '@/lib/i18n/format';
import { REGISTRY } from '@/lib/i18n/registry';

export const BOOKING_ERROR_CODES = [
  'restaurant_unavailable',
  'party_too_large',
  'outside_window',
  'slot_unavailable',
  'past',
  'invalid_name',
  'invalid_phone',
  'invalid_email',
  'full',
  'closed',
  'duplicate',
  'consent_required',
  'too_many_requests',
  'bot_blocked',
  'unknown',
  'network',
] as const;

export type BookingErrorCode = (typeof BOOKING_ERROR_CODES)[number];

export type ErrorKey = `error.${BookingErrorCode}`;

export type ErrorStrings = Record<ErrorKey, string>;

/** English defaults straight from the registry (indexing REGISTRY by every code is the compile-time check that each code has a key); used when the server did not pass resolved strings. */
export const DEFAULT_ERROR_STRINGS = Object.fromEntries(
  BOOKING_ERROR_CODES.map((code) => [`error.${code}`, REGISTRY[`error.${code}`].en]),
) as ErrorStrings;

/**
 * The number a failure names when the chosen restaurant's own is not known yet
 * (its availability never arrived): the resort's switchboard.
 */
export const DEFAULT_PHONE: GroupPhone = { display: FALLBACK_PHONE.display, tel: FALLBACK_PHONE.tel };

/**
 * Used when a message arrives without its params (the server always sends them
 * for slot_unavailable and party_too_large). The drawer passes the chosen
 * restaurant's group phone ahead of these, so {phone} names the right desk.
 */
const DEFAULT_PARAMS: Record<string, string> = {
  restaurant: 'The restaurant',
  max: '12',
  limit: String(PHONE_DAY_LIMIT),
  phone: DEFAULT_PHONE.display,
};

/** A message's params over the defaults, so no placeholder is left showing. */
export function bookingErrorParams(params: Record<string, string> = {}): Record<string, string> {
  return { ...DEFAULT_PARAMS, ...params };
}

export function bookingErrorMessage(
  code: BookingErrorCode,
  params: Record<string, string> = {},
  strings: ErrorStrings = DEFAULT_ERROR_STRINGS,
): string {
  return formatMessage(strings[`error.${code}`], bookingErrorParams(params));
}
