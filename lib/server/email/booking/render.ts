import 'server-only';
import { createElement, type ReactElement } from 'react';
import type { Pool, PoolClient } from 'pg';
import { audienceOf, type EmailAudience, type EmailEvent } from '@/lib/email/events';
import { formatMessage } from '@/lib/i18n/format';
import { registryLocaleDefault, type StringKey } from '@/lib/i18n/registry';
import { resolveStrings } from '@/lib/i18n/resolve';
import { loadSiteSettings } from '@/lib/server/content/settings.queries';
import { loadStringRows } from '@/lib/server/content/strings.queries';
import { appOrigin } from '../auth-emails';
import { renderEmail } from '../send';
import { BookingEmail, type BookingEmailProps } from '../templates/booking';
import { formatEmailDate, formatEmailShortDate, formatEmailTime } from './format';
import type { BookingEmailData } from './load';

/*
 * Booking emails (spec §10.4), rendered at send time from the reservation as
 * it is then (lib/server/email/booking/load.ts): an edit made between the
 * change and the send shows, and nothing personal is copied into
 * email_outbox. Copy comes from the registry keys email.<event>.<field> and
 * email.common.*, overridden by content_strings rows (phase 7) exactly as the
 * guest site resolves them.
 *
 * Language (R10): a guest email uses the reservation's locale while that
 * language is enabled on the site, or while the registry has its own text for
 * every key the email reads (Vietnamese does); otherwise the default language,
 * so a guest never reads English copy with foreign dates. A staff email uses
 * the recipient's locale, enabled or not.
 *
 * Who sees what (code rule 10): guest emails carry the destination's phone and
 * never the admin link, the guest's phone or their note; staff.new carries the
 * guest's details and own request and a link to the booking. Internal notes
 * are never loaded.
 */

type Db = Pool | PoolClient;
export type EmailKey = Extract<StringKey, `email.${string}`>;
export type EmailLocale = { code: string; bcp47: string };

const COMMON_KEYS = [
  'email.common.label_reference',
  'email.common.label_restaurant',
  'email.common.label_date',
  'email.common.label_time',
  'email.common.time_value',
  'email.common.label_guests',
] as const satisfies readonly EmailKey[];

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
  'guest.ack': ['email.guest.ack.subject', 'email.guest.ack.heading', 'email.guest.ack.intro', 'email.common.contact', 'email.common.footer_guest'],
  'guest.confirmed': [
    'email.guest.confirmed.subject',
    'email.guest.confirmed.heading',
    'email.guest.confirmed.intro',
    'email.common.contact',
    'email.common.footer_guest',
  ],
  'guest.declined': [
    'email.guest.declined.subject',
    'email.guest.declined.heading',
    'email.guest.declined.intro',
    'email.common.label_reason',
    'email.common.contact',
    'email.common.footer_guest',
  ],
  'guest.cancelled': [
    'email.guest.cancelled.subject',
    'email.guest.cancelled.heading',
    'email.guest.cancelled.intro',
    'email.common.label_reason',
    'email.common.contact',
    'email.common.footer_guest',
  ],
} as const satisfies Record<EmailEvent, readonly EmailKey[]>;

/** Every registry key one event's email reads. */
export function emailKeys(event: EmailEvent): EmailKey[] {
  return [...COMMON_KEYS, ...EVENT_KEYS[event]];
}

export type BuiltEmail = { subject: string; preview: string; element: ReactElement<BookingEmailProps> };

/**
 * Pure: the subject and the React element of one event's email, from resolved
 * strings. `adminOrigin` builds the staff email's link to the booking.
 */
export function buildBookingEmail(
  event: EmailEvent,
  data: BookingEmailData,
  strings: Readonly<Record<EmailKey, string>>,
  locale: EmailLocale,
  options: { adminOrigin: string },
): BuiltEmail {
  const t = (key: EmailKey, params?: Record<string, string | number>) => formatMessage(strings[key], params, locale.code);
  const time = formatEmailTime(data.time, locale.bcp47);
  const details = [
    { label: t('email.common.label_reference'), value: data.reference },
    { label: t('email.common.label_restaurant'), value: data.restaurantName },
    { label: t('email.common.label_date'), value: formatEmailDate(data.date, locale.bcp47) },
    { label: t('email.common.label_time'), value: t('email.common.time_value', { time }) },
    { label: t('email.common.label_guests'), value: String(data.guests) },
  ];

  if (event === 'staff.new') {
    // R4: auto-confirmed bookings say so; staff need not act on them.
    const intro = t(data.status === 'requested' ? 'email.staff.new.intro_requested' : 'email.staff.new.intro_confirmed');
    const href = `${options.adminOrigin}/admin/reservations/${data.reservationId}`;
    const subject = t('email.staff.new.subject', {
      reference: data.reference,
      restaurant: data.restaurantName,
      date: formatEmailShortDate(data.date, locale.bcp47),
      time,
      guests: data.guests,
    });
    const props: BookingEmailProps = {
      lang: locale.bcp47,
      preview: subject,
      heading: t('email.staff.new.heading'),
      intro,
      details: [
        ...details,
        { label: t('email.staff.new.label_guest'), value: data.guestName },
        { label: t('email.staff.new.label_phone'), value: data.phone },
        ...(data.email ? [{ label: t('email.staff.new.label_email'), value: data.email }] : []),
        // The offer the guest booked from (L7-11); its title is content, so it stays in the default language.
        ...(data.offerTitle ? [{ label: t('email.staff.new.label_offer'), value: data.offerTitle }] : []),
      ],
      quotes: data.note ? [{ label: t('email.staff.new.label_note'), text: data.note }] : [],
      button: { label: t('email.staff.new.button'), href },
      footer: t('email.common.footer_staff'),
    };
    return { subject, preview: subject, element: createElement(BookingEmail, props) };
  }

  const keys = {
    'guest.ack': ['email.guest.ack.subject', 'email.guest.ack.heading', 'email.guest.ack.intro'],
    'guest.confirmed': ['email.guest.confirmed.subject', 'email.guest.confirmed.heading', 'email.guest.confirmed.intro'],
    'guest.declined': ['email.guest.declined.subject', 'email.guest.declined.heading', 'email.guest.declined.intro'],
    'guest.cancelled': ['email.guest.cancelled.subject', 'email.guest.cancelled.heading', 'email.guest.cancelled.intro'],
  } as const satisfies Record<Exclude<EmailEvent, 'staff.new'>, readonly [EmailKey, EmailKey, EmailKey]>;
  const [subjectKey, headingKey, introKey] = keys[event];
  const subject = t(subjectKey, { reference: data.reference });
  const intro = t(introKey, { restaurant: data.restaurantName });
  // status_reason reaches the guest only on a decline or a cancellation (R8).
  const reason = (event === 'guest.declined' || event === 'guest.cancelled') && data.statusReason?.trim() ? data.statusReason.trim() : null;
  const props: BookingEmailProps = {
    lang: locale.bcp47,
    preview: intro,
    heading: t(headingKey),
    intro,
    details,
    quotes: reason ? [{ label: t('email.common.label_reason'), text: reason }] : [],
    contact: data.groupPhone
      ? { text: t('email.common.contact', { phone: data.groupPhone.display }), phone: data.groupPhone.display, tel: data.groupPhone.tel }
      : null,
    footer: t('email.common.footer_guest'),
  };
  return { subject, preview: intro, element: createElement(BookingEmail, props) };
}

// ── language, strings, reply-to ─────────────────────────────────────────────

/** The language an email goes out in (R10, see the header), with its BCP 47 tag for Intl and <html lang>. */
export async function resolveEmailLocale(db: Db, requested: string, audience: EmailAudience, event: EmailEvent): Promise<EmailLocale> {
  const { rows } = await db.query<{ code: string; bcp47: string; is_enabled: boolean; is_default: boolean }>(
    'SELECT code, bcp47, is_enabled, is_default FROM locales WHERE code = $1 OR is_default',
    [requested],
  );
  const asked = rows.find((r) => r.code === requested);
  const fallback = rows.find((r) => r.is_default) ?? { code: 'en', bcp47: 'en' };
  const ownCopy = (code: string) => emailKeys(event).every((key) => registryLocaleDefault(key, code) !== undefined);
  const usable = asked && (audience === 'staff' || asked.is_enabled || ownCopy(asked.code));
  const picked = usable ? asked : fallback;
  return { code: picked.code, bcp47: picked.bcp47 };
}

/** The strings of one event's email in `locale`, with the site's visibility rules; uncached (no Next cache in after() or the cron). */
export async function loadEmailStrings(db: Db, event: EmailEvent, locale: string): Promise<Record<EmailKey, string>> {
  const keys = emailKeys(event);
  const { defaultLocale, rows } = await loadStringRows(locale, keys, db);
  return resolveStrings(rows, keys, locale, defaultLocale) as Record<EmailKey, string>;
}

/** Where a guest's reply lands: the shared inbox (site_settings.email). */
export async function sharedInbox(db: Db): Promise<string | null> {
  return (await loadSiteSettings(db))?.email ?? null;
}

export type RenderedEmail = { subject: string; html: string; text: string; replyTo?: string; locale: string };

/**
 * One outbox row's email, ready for the mailer, from the booking the drain
 * just re-read. Reply-To (R11): staff reply straight to the guest; a guest's
 * reply goes to the shared inbox, never to a staff member's address.
 */
export async function renderOutboxEmail(db: Db, row: { event: EmailEvent; locale: string }, data: BookingEmailData): Promise<RenderedEmail> {
  const audience = audienceOf(row.event);
  const locale = await resolveEmailLocale(db, row.locale, audience, row.event);
  const strings = await loadEmailStrings(db, row.event, locale.code);
  // Only staff.new links to the admin; appOrigin() fails closed without BETTER_AUTH_URL outside log mode (R23).
  const built = buildBookingEmail(row.event, data, strings, locale, { adminOrigin: audience === 'staff' ? appOrigin() : '' });
  const { html, text } = await renderEmail(built.element);
  const replyTo = audience === 'staff' ? (data.email ?? undefined) : ((await sharedInbox(db)) ?? undefined);
  return { subject: built.subject, html, text, replyTo, locale: locale.code };
}
