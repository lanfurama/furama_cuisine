import type { IsoDate } from '@/lib/venue-time';

/*
 * Dates and times in booking emails, in the email's language. reserved_on and
 * reserved_at are already Da Nang's calendar date and wall-clock time, so they
 * are formatted as UTC instants: no server or reader timezone can shift them
 * (the same trick as lib/admin/format.ts formatIsoDayVi). The template says
 * "Da Nang time" next to the time (email.common.time_value).
 *
 * English reads as the site does (R8-8): day first (en-GB) and a 24-hour
 * clock, as Vietnam keeps time. Other languages use their own BCP 47 tag.
 */

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(bcp47: string, kind: 'long' | 'short' | 'time'): Intl.DateTimeFormat {
  const tag = bcp47 === 'en' ? 'en-GB' : bcp47;
  const key = `${tag}|${kind}`;
  let f = cache.get(key);
  if (!f) {
    const options: Intl.DateTimeFormatOptions =
      kind === 'long'
        ? { timeZone: 'UTC', dateStyle: 'full' }
        : kind === 'short'
          ? { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }
          : // "19:00" in English as in Vietnamese; another language's own short time.
            { timeZone: 'UTC', timeStyle: 'short', ...(tag === 'en-GB' ? { hourCycle: 'h23' as const } : {}) };
    try {
      f = new Intl.DateTimeFormat(tag, options);
    } catch {
      // A tag Intl does not know (a hand-added locale): English formatting beats a crash in the sender.
      f = new Intl.DateTimeFormat('en-GB', options);
    }
    cache.set(key, f);
  }
  return f;
}

/** "Monday, 5 October 2026" / "Thứ Hai, 5 tháng 10, 2026". */
export function formatEmailDate(date: IsoDate, bcp47: string): string {
  return formatter(bcp47, 'long').format(new Date(`${date}T00:00:00Z`));
}

/** "Mon, 5 Oct 2026" / "Th 2, 5 thg 10, 2026": for subjects. */
export function formatEmailShortDate(date: IsoDate, bcp47: string): string {
  return formatter(bcp47, 'short').format(new Date(`${date}T00:00:00Z`));
}

/** "19:00" in English and Vietnamese. */
export function formatEmailTime(time: string, bcp47: string): string {
  return formatter(bcp47, 'time').format(new Date(`2000-01-01T${time}:00Z`));
}
