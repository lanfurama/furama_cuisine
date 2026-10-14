import { GUEST_EMAIL_EVENTS, type EmailEvent } from '@/lib/email/events';
import type { StringKey } from '@/lib/i18n/registry';

/*
 * Which registry keys each booking email reads (spec §10.4). No server-only
 * import: lib/server/email/booking/render.ts builds the emails from these, and
 * scripts/sync-locales.mjs checks a language's guest emails are translated
 * before it turns the language on.
 */

export type EmailKey = Extract<StringKey, `email.${string}`>;

const COMMON_KEYS = [
  'email.common.label_reference',
  'email.common.label_restaurant',
  'email.common.label_date',
  'email.common.label_time',
  'email.common.time_value',
  'email.common.label_guests',
] as const satisfies readonly EmailKey[];

type GuestEvent = Exclude<EmailEvent, 'staff.new'>;

/**
 * Each guest email's own keys, written once (phase-5 ledger T5.3): the
 * subject, heading and intro buildBookingEmail prints, and the shared lines it
 * shows after them. emailKeys() and the template both read this table.
 */
export const GUEST_EMAILS = {
  'guest.ack': { subject: 'email.guest.ack.subject', heading: 'email.guest.ack.heading', intro: 'email.guest.ack.intro', reason: false },
  'guest.confirmed': { subject: 'email.guest.confirmed.subject', heading: 'email.guest.confirmed.heading', intro: 'email.guest.confirmed.intro', reason: false },
  'guest.declined': { subject: 'email.guest.declined.subject', heading: 'email.guest.declined.heading', intro: 'email.guest.declined.intro', reason: true },
  'guest.cancelled': { subject: 'email.guest.cancelled.subject', heading: 'email.guest.cancelled.heading', intro: 'email.guest.cancelled.intro', reason: true },
} as const satisfies Record<GuestEvent, { subject: EmailKey; heading: EmailKey; intro: EmailKey; reason: boolean }>;

/** Each guest event's keys, from GUEST_EMAILS alone: a new guest email is one row there. */
function guestEventKeys(): Record<GuestEvent, readonly EmailKey[]> {
  const keys = {} as Record<GuestEvent, readonly EmailKey[]>;
  for (const [event, g] of Object.entries(GUEST_EMAILS) as [GuestEvent, (typeof GUEST_EMAILS)[GuestEvent]][]) {
    keys[event] = [g.subject, g.heading, g.intro, ...(g.reason ? (['email.common.label_reason'] as const) : []), 'email.common.contact', 'email.common.footer_guest'];
  }
  return keys;
}

const EVENT_KEYS = {
  'staff.new': [
    'email.staff.new.subject',
    'email.staff.new.heading',
    'email.staff.new.intro_requested',
    'email.staff.new.intro_confirmed',
    'email.staff.new.label_guest',
    'email.staff.new.label_phone',
    'email.staff.new.label_email',
    'email.staff.new.label_note',
    'email.staff.new.label_offer',
    'email.staff.new.button',
    'email.common.footer_staff',
  ],
  ...guestEventKeys(),
} as const satisfies Record<EmailEvent, readonly EmailKey[]>;

/** Every registry key one event's email reads. */
export function emailKeys(event: EmailEvent): EmailKey[] {
  return [...COMMON_KEYS, ...EVENT_KEYS[event]];
}

/** Every key a guest email reads, once each: what a language must have before guests can use it. */
export function guestEmailKeys(): EmailKey[] {
  return [...new Set(GUEST_EMAIL_EVENTS.flatMap((event) => emailKeys(event)))];
}
