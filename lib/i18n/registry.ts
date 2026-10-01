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
    en: 'Please choose between 1 and 12 guests.',
    maxLength: 140,
    context: 'Party size above the online limit. The numbers will become variables once the limit is configurable.',
    screen: 'ui-text',
  },
  'error.outside_window': {
    en: 'Please choose a date within the next two weeks.',
    maxLength: 140,
    context: 'The date is beyond the booking window.',
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
    en: 'That sitting has already started — please pick a later time.',
    maxLength: 140,
    context: 'The chosen sitting has started or ended.',
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
  'error.unknown': {
    en: 'Something went wrong with your request. Please try again.',
    maxLength: 140,
    context: 'Any server error not covered by another code.',
    screen: 'ui-text',
  },
  'error.network': {
    en: 'We could not reach the reservations desk. Please try again.',
    maxLength: 140,
    context: 'The browser could not reach the server (client side only).',
    screen: 'ui-text',
  },
} as const satisfies Record<string, StringDef>;

export type StringKey = keyof typeof REGISTRY;

export const STRING_KEYS = Object.keys(REGISTRY) as StringKey[];

/** Same pattern as the CHECK on content_strings.key (migration 004). */
export const KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

/** Keys the browser needs at first paint; passed to SiteProvider. Grow this list per component that moves to t(). */
export const CLIENT_KEYS = STRING_KEYS.filter((k) => k.startsWith('error.')) as StringKey[];

/** The registry's own text for a language other than English; only `vi`, and only where declared. */
export function registryLocaleDefault(key: StringKey, locale: string): string | undefined {
  const def: StringDef = REGISTRY[key];
  return locale === 'vi' ? def.vi : undefined;
}
