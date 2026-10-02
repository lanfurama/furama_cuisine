import { NextResponse } from 'next/server';
import { getPool } from '@/db/client';
import { MAX_RANGE_DAYS, type AvailabilityErrorCode, type CalendarResponse, type DayResponse } from '@/lib/booking/api';
import { resolveDay, resolveRange } from '@/lib/booking/resolve-day';
import { DEFAULT_LOCALE, LOCALE_CODE_RE } from '@/lib/i18n/locales';
import { loadBookedCovers, loadRestaurantRules } from '@/lib/server/booking/rules';
import { addDays, daysBetween, isValidIsoDate, venueNow } from '@/lib/venue-time';

/**
 * Availability v2 (spec §10.2): the calendar of one restaurant, or one day's
 * services and slots. Never cached (spec §6.2): under Cache Components a GET
 * handler runs per request once it reads the request (request.url below;
 * node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md:87-124),
 * and every answer says no-store. scripts/check-prerender.mjs fails the build
 * check if this route ever lands in the prerender manifest.
 */

const NO_STORE = { 'cache-control': 'no-store' };
const fail = (status: number, error: AvailabilityErrorCode) => NextResponse.json({ error }, { status, headers: NO_STORE });
const GUESTS = /^[1-9][0-9]?$/;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const restaurant = params.get('restaurant');
  if (!restaurant) return fail(400, 'restaurant_required');
  // An invalid code falls back here; a disabled one falls back in the loader.
  const lang = params.get('lang');
  const locale = lang && LOCALE_CODE_RE.test(lang) ? lang : DEFAULT_LOCALE;

  const date = params.get('date');
  if (date !== null && !isValidIsoDate(date)) return fail(400, 'invalid_date');
  const from = params.get('from');
  const to = params.get('to');
  if ((from !== null && !isValidIsoDate(from)) || (to !== null && !isValidIsoDate(to))) return fail(400, 'invalid_date');
  const guestsParam = params.get('guests');
  if (guestsParam !== null && !(GUESTS.test(guestsParam) && Number(guestsParam) <= 50)) return fail(400, 'invalid_guests');
  const guests = guestsParam === null ? 1 : Number(guestsParam);

  const now = new Date();
  const today = venueNow(now).date;
  try {
    const pool = getPool();
    const loaded = await loadRestaurantRules(pool, restaurant, locale, today);
    if (!loaded || !loaded.rules.bookingEnabled) return fail(404, 'restaurant_unavailable');
    const { rules, groupPhone } = loaded;

    if (date !== null) {
      const booked = (await loadBookedCovers(pool, restaurant, date, date))[date] ?? {};
      const resolved = resolveDay(rules, date, now, booked, guests);
      const body: DayResponse = {
        restaurant,
        today,
        now: now.toISOString(),
        date,
        state: resolved.state,
        ...(resolved.reason ? { reason: resolved.reason } : {}),
        maxParty: rules.maxParty,
        leadMinutes: rules.leadMinutes,
        sameDayCutoff: rules.sameDayCutoff,
        periods: resolved.periods.map((p) => ({
          meal: p.meal,
          closed: p.closed,
          ...(p.reason ? { reason: p.reason } : {}),
          slots: p.closed ? [] : p.slots.map((s) => ({ time: s.time, left: s.left, bookable: s.bookable, ...(s.block ? { block: s.block } : {}) })),
        })),
      };
      return NextResponse.json(body, { headers: NO_STORE });
    }

    const start = from ?? today;
    const end = to ?? addDays(today, rules.windowDays - 1);
    const span = daysBetween(start, end);
    if (span < 0 || span >= MAX_RANGE_DAYS) return fail(400, 'invalid_range');
    const booked = await loadBookedCovers(pool, restaurant, start, end);
    const body: CalendarResponse = {
      restaurant,
      today,
      now: now.toISOString(),
      maxParty: rules.maxParty,
      groupPhone,
      days: resolveRange(rules, start, end, now, booked),
    };
    return NextResponse.json(body, { headers: NO_STORE });
  } catch (err) {
    console.error('availability_failed', { name: err instanceof Error ? err.name : typeof err });
    return fail(503, 'unavailable');
  }
}
