import { addDays, daysBetween, fromMinutes, isoWeekday, toMinutes, venueNow, type IsoDate } from '@/lib/venue-time';
import type {
  BookedCovers,
  BookingRules,
  ClosureRule,
  DayState,
  PeriodRule,
  ResolvedDay,
  ResolvedPeriod,
  ResolvedSlot,
  SlotBlock,
} from './rules';

/*
 * resolveDay (spec §10.1): what one restaurant offers on one date, for a party
 * of `guests`, at the instant `now`. Pure and isomorphic: the guest API and
 * submitReservation (inside its transaction) call it with rules and booked
 * covers they loaded themselves. Staff paths (new booking, edit, preview, day
 * sheet, affected lists) call the clock-free planDay instead: staff may book
 * past the window, on a restaurant whose online booking is off.
 */

/** The seatings of one period: first, first + interval, … up to last. */
export function seatings(period: Pick<PeriodRule, 'firstSeating' | 'lastSeating' | 'intervalMin'>): string[] {
  const first = toMinutes(period.firstSeating);
  const last = toMinutes(period.lastSeating);
  const out: string[] = [];
  if (period.intervalMin <= 0) return out;
  for (let m = first; m <= last; m += period.intervalMin) out.push(fromMinutes(m));
  return out;
}

/** True when the closure reaches this restaurant on this date (both ends inclusive). */
export function closureApplies(c: ClosureRule, rules: Pick<BookingRules, 'restaurantId' | 'destinationId'>, date: IsoDate): boolean {
  if (date < c.startsOn || date > c.endsOn) return false;
  if (c.scope === 'all') return true;
  if (c.scope === 'destination') return c.destinationId === rules.destinationId;
  return c.restaurantId === rules.restaurantId;
}

const byOrder = (a: PeriodRule, b: PeriodRule) =>
  a.sortOrder - b.sortOrder || toMinutes(a.firstSeating) - toMinutes(b.firstSeating);

/** One service on one date, before the clock, the bookings or the party size are applied. */
export type PlannedPeriod = {
  periodId: string;
  meal: PeriodRule['meal'];
  closed: boolean;
  reason: string | null;
  slots: { time: string; capacity: number }[];
};

/**
 * Steps 1–3 of spec §10.1 for one date: the active periods of its weekday,
 * closures applied, slots generated. Clock-free, so the admin uses it to
 * preview a schedule and to find the bookings an edit or a closure leaves out.
 */
export function planDay(
  rules: Pick<BookingRules, 'restaurantId' | 'destinationId' | 'periods' | 'closures'>,
  date: IsoDate,
): { periods: PlannedPeriod[]; wholeDayReason: string | null } {
  const weekday = isoWeekday(date);
  const closures = rules.closures.filter((c) => closureApplies(c, rules, date));
  const wholeDay = closures.filter((c) => c.meals === null);
  // Two periods that share a time (an admin save rejects this) would double the
  // slot, and capacity is keyed by time; the first by sort order keeps it.
  const seen = new Set<string>();
  const periods = rules.periods
    .filter((p) => p.active !== false && p.weekdays.includes(weekday))
    .sort(byOrder)
    .map((p) => {
      const closure = wholeDay[0] ?? closures.find((c) => c.meals?.includes(p.meal));
      const slots = seatings(p)
        .filter((time) => !seen.has(time) && Boolean(seen.add(time)))
        .map((time) => ({ time, capacity: p.coversPerSlot }));
      return { periodId: p.id, meal: p.meal, closed: Boolean(closure), reason: closure?.publicReason ?? null, slots };
    });
  return { periods, wholeDayReason: wholeDay.find((c) => c.publicReason)?.publicReason ?? null };
}

/**
 * Whether the clock alone closes a sitting (spec §10.1 step 4, first two
 * rules). Lead: venueNow truncates to the minute, so "minutes left > lead" is
 * "at least lead minutes left" (at 18:30:59, 19:00 is 30 minutes away on the
 * clock but only 29 min 1 s remain). Cut-off: today only, from the cut-off
 * minute. The guest form calls this with the server's rules and clock offset.
 */
export function clockBlock(
  date: IsoDate,
  time: string,
  now: Date,
  rules: Pick<BookingRules, 'leadMinutes' | 'sameDayCutoff'>,
): 'lead' | 'cutoff' | null {
  const clock = venueNow(now);
  const offset = daysBetween(clock.date, date);
  if (offset * 1440 + toMinutes(time) - clock.minutes <= rules.leadMinutes) return 'lead';
  if (offset === 0 && rules.sameDayCutoff !== null && clock.minutes >= toMinutes(rules.sameDayCutoff)) return 'cutoff';
  return null;
}

export function resolveDay(
  rules: BookingRules,
  date: IsoDate,
  now: Date,
  booked: BookedCovers = {},
  guests = 1,
): ResolvedDay {
  if (!rules.bookingEnabled) return { date, state: 'unavailable', reason: null, periods: [] };

  const offset = daysBetween(venueNow(now).date, date);
  if (offset < 0 || offset >= rules.windowDays) return { date, state: 'outside', reason: null, periods: [] };

  const tooLarge = guests > rules.maxParty;
  const plan = planDay(rules, date);

  const periods: ResolvedPeriod[] = plan.periods.map((p) => ({
    ...p,
    slots: p.slots.map(({ time, capacity }): ResolvedSlot => {
      const taken = booked[time] ?? 0;
      const block: SlotBlock | undefined = p.closed
        ? 'closed'
        : (clockBlock(date, time, now, rules) ?? (tooLarge ? 'party' : taken + guests > capacity ? 'full' : undefined));
      return { time, capacity, booked: taken, left: Math.max(0, capacity - taken), bookable: block === undefined, ...(block ? { block } : {}) };
    }),
  }));

  const closedReason = periods.find((p) => p.closed && p.reason)?.reason ?? plan.wholeDayReason;
  return { date, ...dayState(periods, tooLarge, closedReason), periods };
}

function dayState(periods: ResolvedPeriod[], tooLarge: boolean, closedReason: string | null): { state: DayState; reason: string | null } {
  const open = periods.filter((p) => !p.closed).flatMap((p) => p.slots);
  if (open.length === 0) return { state: 'closed', reason: closedReason };
  if (tooLarge) return { state: 'too_large', reason: null };
  if (open.every((s) => s.block === 'lead' || s.block === 'cutoff')) return { state: 'past', reason: null };
  return { state: open.some((s) => s.bookable) ? 'open' : 'full', reason: null };
}

/** The period and slot a time belongs to on a resolved day, if any. */
export function findSlot(day: ResolvedDay, time: string): { period: ResolvedPeriod; slot: ResolvedSlot } | null {
  for (const period of day.periods) {
    const slot = period.slots.find((s) => s.time === time);
    if (slot) return { period, slot };
  }
  return null;
}

/** Day states for a calendar strip: from..to inclusive, a party of one. */
export function resolveRange(
  rules: BookingRules,
  from: IsoDate,
  to: IsoDate,
  now: Date,
  bookedByDate: Record<IsoDate, BookedCovers>,
): { date: IsoDate; state: DayState; reason?: string }[] {
  const out: { date: IsoDate; state: DayState; reason?: string }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const day = resolveDay(rules, d, now, bookedByDate[d] ?? {});
    out.push(day.reason ? { date: d, state: day.state, reason: day.reason } : { date: d, state: day.state });
  }
  return out;
}
