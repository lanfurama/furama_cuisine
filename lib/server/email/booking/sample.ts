import 'server-only';
import type { Pool } from 'pg';
import { audienceOf, type EmailEvent } from '@/lib/email/events';
import { addDays, venueNow } from '@/lib/venue-time';
import { renderEmail } from '../send';
import type { BookingEmailData } from './load';
import { buildBookingEmail, loadEmailStrings, resolveEmailLocale, sharedInbox } from './render';

/*
 * "Gửi email thử" (spec §10.4, R9) and, from phase 7, /admin/content/emails
 * "xem trước với dữ liệu mẫu": a made-up booking, so no guest's data is ever
 * sent to the address an Admin types. Nothing here is written to the
 * database, and the staff link points at /admin/reservations/0, which
 * answers "not found".
 */
export function sampleBooking(now: Date = new Date()): BookingEmailData {
  return {
    reservationId: '0',
    reference: 'FC-0000TEST',
    restaurantName: 'Tàya House',
    date: addDays(venueNow(now).date, 3),
    time: '19:00',
    guests: 4,
    status: 'requested',
    statusReason: 'Nhà hàng có tiệc riêng tối hôm đó. / The restaurant is booked for a private event that evening.',
    guestName: 'Nguyễn Thị Mẫu',
    phone: '0905 000 000',
    email: 'khach.mau@example.com',
    note: 'Bàn gần cửa sổ, có một ghế trẻ em.',
    groupPhone: { display: '+84 236 651 9999', tel: '+842366519999' },
    anonymized: false,
  };
}

export const TEST_SUBJECT_PREFIX = '[Email thử] ';

/**
 * The sample booking's `event` email in `locale`, as a recipient with that
 * language would get it (the staff rule: shown even while the language is
 * off on the site), its subject marked as a test, its Reply-To as R11 sets it.
 */
export async function renderSampleEmail(
  pool: Pool,
  event: EmailEvent,
  locale: string,
  options: { adminOrigin: string; now?: Date },
): Promise<{ subject: string; html: string; text: string; replyTo?: string; locale: string }> {
  const sample = sampleBooking(options.now);
  const resolved = await resolveEmailLocale(pool, locale, 'staff', event);
  const strings = await loadEmailStrings(pool, event, resolved.code);
  const built = buildBookingEmail(event, sample, strings, resolved, { adminOrigin: options.adminOrigin });
  const { html, text } = await renderEmail(built.element);
  const replyTo = audienceOf(event) === 'staff' ? (sample.email ?? undefined) : ((await sharedInbox(pool)) ?? undefined);
  return { subject: `${TEST_SUBJECT_PREFIX}${built.subject}`, html, text, replyTo, locale: resolved.code };
}
