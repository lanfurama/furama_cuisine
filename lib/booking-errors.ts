/**
 * What can go wrong with a table request. The server returns only these
 * codes; the browser turns them into copy. The copy lives in the content
 * registry (lib/i18n/registry.ts) as error.<code>, so the DB can override it.
 */
import { CONTACT } from '@/lib/data';
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

/** Used when a message arrives without its params (the server always sends them for slot_unavailable and party_too_large). */
const DEFAULT_PARAMS: Record<string, string> = { restaurant: 'The restaurant', max: '12', phone: CONTACT.resortPhoneLabel };

export function bookingErrorMessage(
  code: BookingErrorCode,
  params: Record<string, string> = {},
  strings: ErrorStrings = DEFAULT_ERROR_STRINGS,
): string {
  return formatMessage(strings[`error.${code}`], { ...DEFAULT_PARAMS, ...params });
}
