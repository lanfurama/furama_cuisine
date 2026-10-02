/**
 * Calendar maths in the venue's timezone (Asia/Ho_Chi_Minh: UTC+7, no DST).
 * Runs in the browser and on the server alike, so both agree on "today" and
 * on how long until a sitting, whatever timezone either machine is set to.
 */
export const VENUE_TZ = 'Asia/Ho_Chi_Minh';

/** A calendar date as YYYY-MM-DD. */
export type IsoDate = string;

const clock = new Intl.DateTimeFormat('en-CA', {
  timeZone: VENUE_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23', // never "24:05" just after midnight
});

/** The venue's current date and minutes since its midnight. */
export function venueNow(now: Date = new Date()): { date: IsoDate; minutes: number } {
  const p = Object.fromEntries(clock.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

const DAY_MS = 86_400_000;
const utcMidnight = (d: IsoDate) => Date.parse(`${d}T00:00:00Z`);

export function addDays(d: IsoDate, n: number): IsoDate {
  return new Date(utcMidnight(d) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((utcMidnight(to) - utcMidnight(from)) / DAY_MS);
}

/** True for real calendar dates written as YYYY-MM-DD (rejects 2026-02-30). */
export function isValidIsoDate(s: unknown): s is IsoDate {
  return (
    typeof s === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(utcMidnight(s)) &&
    addDays(s, 0) === s
  );
}

/** ISO weekday of a calendar date: 1 = Monday … 7 = Sunday (spec §5.2 service_periods.weekdays). */
export const isoWeekday = (d: IsoDate): number => new Date(utcMidnight(d)).getUTCDay() || 7;

export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** 1140 → "19:00". */
export const fromMinutes = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Minutes from the venue's "now" until `hhmm` on `date`; negative once it has passed. */
export function minutesUntil(date: IsoDate, hhmm: string, now: Date = new Date()): number {
  const v = venueNow(now);
  return daysBetween(v.date, date) * 1440 + toMinutes(hhmm) - v.minutes;
}

const partOf = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options });
const WEEKDAY = partOf({ weekday: 'short' });
const MONTH = partOf({ month: 'short' });

/** Display pieces for a date ("Thu", "1", "Oct") and the joined "Thu, 1 Oct". */
export function formatDay(d: IsoDate) {
  const at = new Date(utcMidnight(d));
  const weekday = WEEKDAY.format(at);
  const month = MONTH.format(at);
  const day = String(at.getUTCDate());
  return { weekday, day, month, label: `${weekday}, ${day} ${month}` };
}
