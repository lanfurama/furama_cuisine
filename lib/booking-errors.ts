/**
 * What can go wrong with a table request. The server returns only these
 * codes; the browser turns them into copy. The English copy lives here until
 * the content registry (lib/i18n/registry.ts) arrives in phase 2.
 */
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
  'duplicate',
  'unknown',
  'network',
] as const;

export type BookingErrorCode = (typeof BOOKING_ERROR_CODES)[number];

const MESSAGES: Record<BookingErrorCode, string> = {
  restaurant_unavailable: 'That restaurant is no longer available.',
  party_too_large: 'Please choose between 1 and 12 guests.',
  outside_window: 'Please choose a date within the next two weeks.',
  slot_unavailable: '{restaurant} does not serve at that time.',
  past: 'That sitting has already started — please pick a later time.',
  invalid_name: 'Please enter your name.',
  invalid_phone: 'Please enter a valid phone number.',
  invalid_email: 'Please check your email address.',
  full: 'That slot just filled up — please choose another time.',
  duplicate: 'We already have a request for this table under your number.',
  unknown: 'Something went wrong with your request. Please try again.',
  network: 'We could not reach the reservations desk. Please try again.',
};

const DEFAULT_PARAMS: Record<string, string> = { restaurant: 'The restaurant' };

export function bookingErrorMessage(code: BookingErrorCode, params: Record<string, string> = {}): string {
  return MESSAGES[code].replace(/\{(\w+)\}/g, (_, key: string) => params[key] ?? DEFAULT_PARAMS[key] ?? '');
}
