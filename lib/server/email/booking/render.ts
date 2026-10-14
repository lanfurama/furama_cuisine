import 'server-only';
import { createElement, type ReactElement } from 'react';
import type { Pool, PoolClient } from 'pg';
import type { ReservationStatus } from '@/lib/booking/rules';
import { audienceOf, type EmailAudience, type EmailEvent } from '@/lib/email/events';
import { emailKeys, GUEST_EMAILS, type EmailKey } from '@/lib/email/keys';
import { formatMessage } from '@/lib/i18n/format';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';
import { SITE_LOCALE_ROWS } from '@/lib/i18n/site-locales';
import { registryLocaleDefault } from '@/lib/i18n/registry';
import { resolveStrings } from '@/lib/i18n/resolve';
import { loadSiteSettings } from '@/lib/server/content/settings.queries';
import { loadStringRows } from '@/lib/server/content/strings.queries';
import { appOrigin } from '../origin';
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
 * Language (R10): a guest email uses the reservation's locale while the
 * registry has its own text for every key the email reads (Vietnamese does),
 * or while that language is enabled on the site (lib/i18n/site-locales.ts)
 * and reviewed rows fill every key the registry lacks; otherwise the default
 * language, so a guest never reads English copy with foreign dates. A staff
 * email uses the recipient's locale, enabled or not.
 *
 * Who sees what (code rule 10): guest emails carry the destination's phone and
 * never the admin link, the guest's phone or their note; staff.new carries the
 * guest's details and own request and a link to the booking. Internal notes
 * are never loaded.
 */

type Db = Pool | PoolClient;
export type EmailLocale = { code: string; bcp47: string };

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
  options: { adminOrigin: string; createdStatus?: ReservationStatus | null },
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
    // R4: auto-confirmed bookings say so; staff need not act on them. The status the booking was created with
    // (its created event), not today's: a retry after staff confirmed it by hand is still a request (T5.1).
    const created = options.createdStatus ?? data.status;
    const intro = t(created === 'requested' ? 'email.staff.new.intro_requested' : 'email.staff.new.intro_confirmed');
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

  const own = GUEST_EMAILS[event];
  const subject = t(own.subject, { reference: data.reference });
  const intro = t(own.intro, { restaurant: data.restaurantName });
  // status_reason reaches the guest only on a decline or a cancellation (R8).
  const reason = own.reason && data.statusReason?.trim() ? data.statusReason.trim() : null;
  const props: BookingEmailProps = {
    lang: locale.bcp47,
    preview: intro,
    heading: t(own.heading),
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
  const asked = SITE_LOCALE_ROWS.find((l) => l.code === requested);
  const fallback = SITE_LOCALE_ROWS.find((l) => l.isDefault) ?? { code: DEFAULT_LOCALE, bcp47: DEFAULT_LOCALE };
  const keys = emailKeys(event);
  // The default language always has its own copy (the registry's English); another one when the registry writes every key in it (T5.2).
  const ownCopy = (code: string) => code === DEFAULT_LOCALE || keys.every((key) => registryLocaleDefault(key, code) !== undefined);
  // An enabled language whose copy of this email is whole, reviewed rows filling what the registry lacks (R8-6):
  // never half the email in English.
  const whole = async (code: string) => {
    const { rows } = await db.query<{ key: string }>(
      `SELECT key FROM content_strings WHERE locale = $1 AND key = ANY ($2::text[]) AND status = 'reviewed'`,
      [code, keys],
    );
    const saved = new Set(rows.map((r) => r.key));
    return keys.every((key) => saved.has(key) || registryLocaleDefault(key, code) !== undefined);
  };
  const usable = asked && (audience === 'staff' || ownCopy(asked.code) || (asked.isEnabled && (await whole(asked.code))));
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
export async function renderOutboxEmail(
  db: Db,
  row: { event: EmailEvent; locale: string; reservation_event_id?: string | null },
  data: BookingEmailData,
): Promise<RenderedEmail> {
  const audience = audienceOf(row.event);
  const locale = await resolveEmailLocale(db, row.locale, audience, row.event);
  const strings = await loadEmailStrings(db, row.event, locale.code);
  const createdStatus = row.event === 'staff.new' && row.reservation_event_id ? await eventStatus(db, row.reservation_event_id) : null;
  // Only staff.new links to the admin; appOrigin() fails closed without BETTER_AUTH_URL outside log mode (R23).
  const built = buildBookingEmail(row.event, data, strings, locale, { adminOrigin: audience === 'staff' ? appOrigin() : '', createdStatus });
  const { html, text } = await renderEmail(built.element);
  const replyTo = audience === 'staff' ? (data.email ?? undefined) : ((await sharedInbox(db)) ?? undefined);
  return { subject: built.subject, html, text, replyTo, locale: locale.code };
}

/** The status an event left the booking in: for staff.new, the created event's (requested or confirmed). */
async function eventStatus(db: Db, eventId: string): Promise<ReservationStatus | null> {
  const { rows } = await db.query<{ to_status: ReservationStatus | null }>('SELECT to_status FROM reservation_events WHERE id = $1', [eventId]);
  return rows[0]?.to_status ?? null;
}
