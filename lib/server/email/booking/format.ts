import type { IsoDate } from '@/lib/venue-time';

/*
 * Dates and times in booking emails, in the email's language. reserved_on and
 * reserved_at are already Da Nang's calendar date and wall-clock time, so they
 * are formatted as UTC instants: no server or reader timezone can shift them
 * (the same trick as lib/admin/format.ts formatIsoDayVi). The template says
 * "Da Nang time" next to the time (email.common.time_value).
 */

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(bcp47: string, kind: 'long' | 'short' | 'time'): Intl.DateTimeFormat {
  const key = `${bcp47}|${kind}`;
  let f = cache.get(key);
  if (!f) {
    const options: Intl.DateTimeFormatOptions =
      kind === 'long'
        ? { timeZone: 'UTC', dateStyle: 'full' }
        : kind === 'short'
          ? { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }
          : // The language's own clock: "7:00 PM" in English, "19:00" (two-digit hour) in Vietnamese.
            { timeZone: 'UTC', timeStyle: 'short' };
    try {
      f = new Intl.DateTimeFormat(bcp47, options);
    } catch {
      // A tag Intl does not know (a hand-added locale): English formatting beats a crash in the sender.
      f = new Intl.DateTimeFormat('en', options);
    }
    cache.set(key, f);
  }
  return f;
}

/** "Monday, October 5, 2026" / "Thứ Hai, 5 tháng 10, 2026". */
export function formatEmailDate(date: IsoDate, bcp47: string): string {
  return formatter(bcp47, 'long').format(new Date(`${date}T00:00:00Z`));
}

/** "Mon, Oct 5, 2026" / "Th 2, 5 thg 10, 2026": for subjects. */
export function formatEmailShortDate(date: IsoDate, bcp47: string): string {
  return formatter(bcp47, 'short').format(new Date(`${date}T00:00:00Z`));
}

/** "7:00 PM" / "19:00". */
export function formatEmailTime(time: string, bcp47: string): string {
  return formatter(bcp47, 'time').format(new Date(`2000-01-01T${time}:00Z`));
}
