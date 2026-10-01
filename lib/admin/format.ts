import { VENUE_TZ } from '@/lib/venue-time';

/*
 * Dates in the admin: Vietnamese, on Vietnam's clock whatever the server's TZ
 * (Vercel runs in UTC) — spec §7.3. Formatters are built once; Intl objects
 * are expensive to create.
 */
const dateTime = new Intl.DateTimeFormat('vi-VN', {
  timeZone: VENUE_TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const longDate = new Intl.DateTimeFormat('vi-VN', { timeZone: VENUE_TZ, dateStyle: 'full' });

type DateInput = Date | string | number;

/** "00:30 02/10/2026" */
export function formatDateTimeVi(value: DateInput): string {
  return dateTime.format(new Date(value));
}

/** "Thứ Sáu, 2 tháng 10, 2026" */
export function formatLongDateVi(value: DateInput): string {
  return longDate.format(new Date(value));
}

/** Today's date in Vietnam, written out. Admin pages render at request time, so "now" is the request's. */
export function todayVi(now: Date = new Date()): string {
  return longDate.format(now);
}
