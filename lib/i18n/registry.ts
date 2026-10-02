/**
 * The list of translatable guest-site strings (spec §5.1 item 2). The code
 * decides which keys exist; the content_strings table only overrides or
 * translates them, and a key with no row falls back to the default here.
 */

/** Admin screens that can edit strings (spec §7.2); a CI test checks every key names one. */
export const ADMIN_SCREENS = [
  'hero',
  'booking',
  'navigation',
  'contact',
  'seo',
  'legal',
  'emails',
  'ui-text',
] as const;
export type AdminScreen = (typeof ADMIN_SCREENS)[number];

export type StringDef = {
  /** English default; always present. */
  en: string;
  /** Vietnamese default; only for email.* and legal.* (spec §5.1). */
  vi?: string;
  /** Longest value an editor may save, counted in characters. */
  maxLength: number;
  /** Placeholder names the value may use, written {name}. */
  vars?: readonly string[];
  /** Where the text appears and what it must keep. Shown to translators and given to the AI. */
  context: string;
  /** The admin screen that edits this key. */
  screen: AdminScreen;
};

// `satisfies` keeps the literal key names, so StringKey is a real union.
export const REGISTRY = {
  'error.restaurant_unavailable': {
    en: 'That restaurant is no longer available.',
    maxLength: 140,
    context: 'Shown under the reservation form when the chosen restaurant stopped taking online bookings.',
    screen: 'ui-text',
  },
  'error.party_too_large': {
    en: 'For more than {max} guests, please call us on {phone}.',
    maxLength: 140,
    vars: ['max', 'phone'],
    context:
      'Party size above the online limit. {max} is the largest party bookable online (booking rules), {phone} the restaurant’s number for larger groups; keep both as is.',
    screen: 'ui-text',
  },
  'error.outside_window': {
    en: 'That date can’t be booked online — please choose one of the dates shown.',
    maxLength: 140,
    context:
      'The date is outside this restaurant’s booking window (staff set it per restaurant, from 1 to 90 days), or is not a real date. Do not name a span of days or weeks: it differs per restaurant.',
    screen: 'ui-text',
  },
  'error.slot_unavailable': {
    en: '{restaurant} does not serve at that time.',
    maxLength: 140,
    vars: ['restaurant'],
    context: 'The time is not in the restaurant’s service hours. {restaurant} is the restaurant name; keep it as is.',
    screen: 'ui-text',
  },
  'error.past': {
    en: 'That time can no longer be booked online — please choose a later time or another day.',
    maxLength: 140,
    context:
      'The chosen sitting is too close to book online (the lead time before it), or online booking for today has closed (the same-day cut-off). Must read right for both.',
    screen: 'ui-text',
  },
  'error.invalid_name': {
    en: 'Please enter your name.',
    maxLength: 140,
    context: 'Name field is empty or invalid.',
    screen: 'ui-text',
  },
  'error.invalid_phone': {
    en: 'Please enter a valid phone number.',
    maxLength: 140,
    context: 'Phone field failed validation.',
    screen: 'ui-text',
  },
  'error.invalid_email': {
    en: 'Please check your email address.',
    maxLength: 140,
    context: 'Email field failed validation.',
    screen: 'ui-text',
  },
  'error.full': {
    en: 'That slot just filled up — please choose another time.',
    maxLength: 140,
    context: 'No covers left at the chosen time.',
    screen: 'ui-text',
  },
  'error.duplicate': {
    en: 'We already have a request for this table under your number.',
    maxLength: 140,
    context: 'The same phone number already has an active request for this restaurant, date and time.',
    screen: 'ui-text',
  },
  'error.closed': {
    en: 'The restaurant is closed at that time — please choose another time or day.',
    maxLength: 140,
    context:
      'A closure, or a day without service, covers the chosen date, or only the chosen meal while another meal that day still takes bookings. Must read right for both.',
    screen: 'ui-text',
  },
  'error.unknown': {
    en: 'Something went wrong with your request. Please try again.',
    maxLength: 140,
    context: 'Any server error not covered by another code.',
    screen: 'ui-text',
  },
  'error.network': {
    en: 'We could not reach the reservations desk. Please try again.',
    maxLength: 140,
    context:
      'The browser could not reach the server, or it could not answer (client side only): on sending the form, and in place of the dates or times when they could not be loaded, above booking.retry.',
    screen: 'ui-text',
  },
  'booking.day_closed': {
    en: 'Closed',
    maxLength: 40,
    context: 'Reservation form, on a date that takes no bookings when the closure has no public reason. Short: it also fits a dropdown note.',
    screen: 'booking',
  },
  'booking.day_full': {
    en: 'Fully booked',
    maxLength: 40,
    context: 'Reservation form, on a date with no tables left at any time. Short: it also fits a dropdown note.',
    screen: 'booking',
  },
  'booking.day_past': {
    en: 'No more tables today',
    maxLength: 40,
    context: 'Reservation form, on today once every sitting has closed to online booking.',
    screen: 'booking',
  },
  'booking.day_note': {
    en: '{date}: {reason}',
    maxLength: 60,
    vars: ['date', 'reason'],
    context:
      'Line under the date strip after a guest taps a date that takes no bookings, and that date’s spoken name. {date} is the formatted date, {reason} the public closure reason or one of booking.day_*; keep both.',
    screen: 'booking',
  },
  'booking.meal_closed': {
    en: 'Not available on this date.',
    maxLength: 80,
    context: 'Under a meal heading (Lunch, Dinner…) when a closure takes out that meal only. The public reason, if any, follows on its own line.',
    screen: 'booking',
  },
  'booking.no_dates': {
    en: 'No dates are open for online booking. Please call us on {phone}.',
    maxLength: 140,
    vars: ['phone'],
    context: 'Reservation form, when no date in the booking window takes bookings. {phone} is the restaurant’s number; keep it.',
    screen: 'booking',
  },
  'booking.day_outside': {
    en: 'Not open for booking yet',
    maxLength: 40,
    context:
      'Reservation form: why a date cannot be booked when it lies beyond this restaurant’s booking window (staff set it per restaurant). Used as {reason} in booking.date_moved. Short.',
    screen: 'booking',
  },
  'booking.date_moved': {
    en: '{date} can’t be booked ({reason}). Your table is now set for {to}.',
    maxLength: 160,
    vars: ['date', 'reason', 'to'],
    context:
      'Line under the date strip when the form had to move the chosen date: another restaurant was chosen (or fresh availability arrived) and it does not take that date, so the nearest open day was chosen instead. {date} is the date given up, {reason} the public closure reason or one of booking.day_* (booking.day_outside beyond the window), {to} the new date; keep all three.',
    screen: 'booking',
  },
  'booking.loading': {
    en: 'Checking tables…',
    maxLength: 40,
    context:
      'Reservation form, while availability loads: under DATE before the first dates arrive, in place of the time slots, and beside REQUEST BOOKING when it is pressed before the dates have arrived.',
    screen: 'booking',
  },
  'booking.done_requested': {
    en: 'Your table request at {restaurant} has been received. Our team will contact you shortly to confirm.',
    maxLength: 200,
    vars: ['restaurant'],
    context:
      'Thank-you screen of the reservation form when the booking waits for staff to confirm it (status requested). {restaurant} is the restaurant name; keep it. Must say the same as the guest.ack email (phase 5).',
    screen: 'booking',
  },
  'booking.done_confirmed': {
    en: 'Your table at {restaurant} is confirmed. We look forward to welcoming you.',
    maxLength: 200,
    vars: ['restaurant'],
    context:
      'Thank-you screen of the reservation form when the restaurant confirms online bookings at once (auto-confirm; status confirmed): nobody will call to confirm. {restaurant} is the restaurant name; keep it. Must say the same as the guest.confirmed email (phase 5).',
    screen: 'booking',
  },
  'booking.retry': {
    en: 'Try again',
    maxLength: 30,
    context:
      'Reservation form, a button under error.network when the dates or the times could not be loaded (server error or no connection); it asks the server again.',
    screen: 'booking',
  },
} as const satisfies Record<string, StringDef>;

export type StringKey = keyof typeof REGISTRY;

export const STRING_KEYS = Object.keys(REGISTRY) as StringKey[];

/** Same pattern as the CHECK on content_strings.key (migration 004). */
export const KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

/** Keys the browser needs: the reservation form's copy and its error messages. */
export type ClientKey = Extract<StringKey, `error.${string}` | `booking.${string}`>;

/** Keys the browser needs at first paint; passed to SiteProvider. Grow this list per component that moves to t(). */
export const CLIENT_KEYS = STRING_KEYS.filter((k): k is ClientKey => k.startsWith('error.') || k.startsWith('booking.'));

/** The registry's own text for a language other than English; only `vi`, and only where declared. */
export function registryLocaleDefault(key: StringKey, locale: string): string | undefined {
  const def: StringDef = REGISTRY[key];
  return locale === 'vi' ? def.vi : undefined;
}
