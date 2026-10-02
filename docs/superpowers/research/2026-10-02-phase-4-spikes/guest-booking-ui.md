# Phase-4 guest booking UI spike (p4-guest)

> Spike report, key `guest-booking-ui` (clone `p4-guest`). Topic: the guest booking UI on server-provided availability.
> Where this report and `00-plan-outline.md` disagree, the outline wins (see its §0). In particular, the outline replaces this spike's `lib/booking/plan.ts`, `lib/booking/types.ts` and `lib/server/booking/availability.ts` stub with the engine spike's `resolveDay` and a merged API contract.

The spike works end to end and passes every gate.
- **Working clone:** `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p4-guest`. It holds every file named below.
- **Complete patch:** `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p4g-guest.patch`. It is 2797 lines, covers 34 files (+1613 / −482), and `git apply --check` applies it cleanly to `3c04ace`.
- The original repo is untouched. `git status` is clean at `3c04ace`.
- The spike database `furama_cuisine_p4guest_test` has been dropped, and nothing is listening on ports 3230–3239.

## 1. Map: what the client computed itself at HEAD 3c04ace (all must come from the server in phase 4)

| Constant or derivation | Where the client used it (HEAD line numbers) | Server-side users |
|---|---|---|
| `BOOKING_WINDOW_DAYS = 14` (`lib/booking.ts:24`) via `bookingDates()` (:30) | `SiteProvider.tsx:538` `dayList = bookingDates(today)`. This list feeds the day strip (`ReserveDrawer.tsx:144`) and the bar's Date dropdown (`BookingBar.tsx:27`). | `route.ts` `inWindow`, `check-reservation.ts:56` |
| `LEAD_MINUTES = 30` (:26) via `isSittingClosed` (:55) | Used by `unavailable()` (:73) in `BookingBar.tsx:35` and `ReserveDrawer.tsx:52,194`, by `defaultDate()` (:60, the mount effect at `SiteProvider.tsx:203-211` and `openReserve` at :346-366), and by the submit gate (`SiteProvider.tsx:403,409`). | `check-reservation.ts:63` |
| `MAX_GUESTS = 12` (:27) | `BookingBar.tsx:46` (guest options) and `ReserveDrawer.tsx:180-181` (the + stepper) | `check-reservation.ts:53` |
| `SLOTS` (`lib/data.ts:77`) × `restaurants.meals`, via `slotsFor` (`lib/booking.ts:45`) | Time options (`BookingBar.tsx:33`), slot groups (`ReserveDrawer.tsx:50,189`), and `normTime`/`reconcile`/`slotBookable`/`defaultDate` | `check-reservation.ts:61` |
| `slot_capacity` | Not used on the client; it arrived as `capacity` in the v1 API. `NO_AVAILABILITY` (`lib/booking.ts:21`) meant infinite capacity before the first answer. | `route.ts`, `db/queries.ts:130-150` (`FOR UPDATE`) |
| `Restaurant.meals` | `SiteProvider.tsx:277` (Occasion filter) | — |
| Device-clock today | `SiteProvider.tsx:203-211` (`venueNow()` on mount) and :349 (`openReserve`) | — |
| `DEFAULT_RESTAURANT_ID` (`lib/data.ts:27`) | `SiteProvider.tsx:177` | — |
| Hard-coded copy | "Today", "Tomorrow", "Full", "N left" notes; "No tables left on this date…" (`ReserveDrawer.tsx:222`); `error.party_too_large` hard-coded "1 and 12" in `registry.ts:44` | — |

`Finder.tsx:14` (`MEALS`, the Occasion options) and `MEAL_LABELS` are static labels, not availability, so they stay as they are.

RESERVE entry points at HEAD:
- **Generic** (open the drawer on the current restaurant): `Header.tsx:95,119`, `MenuOverlay.tsx:67`, `MobileBar.tsx:64` (home tab bar), and `BookingBar.tsx:97` (FIND A TABLE).
- **Per restaurant:**
  - `TayaHero.tsx:50-56` (RESERVE A TABLE);
  - `MobileBar.tsx:35-44` (detail-page RESERVE);
  - `Offers.tsx:43-49` (VIEW OFFER opens the drawer for the offer's restaurant);
  - `RestaurantCard.tsx:36`: the "Reserve a table" tag, with `openRestaurant` at `SiteProvider.tsx:378-391` opening the drawer for cards without a detail page;
  - `SearchOverlay.tsx:94-96` (the "Reserve" label).

After the spike, no `'use client'` module imports `SLOTS`, `MAX_GUESTS`, `BOOKING_WINDOW_DAYS` or `LEAD_MINUTES` (checked with grep). They remain only in `lib/booking.ts` for `check-reservation.ts` and the stub. The only per-restaurant data the client still derives itself is `r.meals` for the Occasion filter; spec §6.3 item 2 says the server computes that catalogue field from active service periods.

## 2. API contract (proposal): types shared by the route and the client

`lib/booking/types.ts`, full file:

```ts
import type { Meal } from '@/lib/data';
import type { IsoDate } from '@/lib/venue-time';

/** open: some slot takes 1 guest; closed: whole-day closure or no period that weekday;
 *  full: every slot still open by the clock has 0 left; past: (today) every sitting past lead/cutoff. */
export type DayState = 'open' | 'closed' | 'full' | 'past';
export type DayInfo = { date: IsoDate; state: DayState; /** closure_i18n.public_reason (lang, EN fallback); absent when show_reason off */ reason?: string };
export type GroupPhone = { display: string; tel: string };

/** Range form: ?restaurant=&lang=[&from=&to=] */
export type CalendarResponse = {
  restaurant: string; today: IsoDate; /** server instant ISO (phase-1 deviation from nowMinutes) */ now: string;
  maxParty: number; groupPhone: GroupPhone; /** window_days entries, today first */ days: DayInfo[];
};
export type SlotInfo = { time: string; /** capacity − held, ≥0 */ left: number; /** by server clock, for `guests` (default 1) */ bookable: boolean };
export type PeriodInfo = { meal: Meal; closed: boolean; reason?: string; slots: SlotInfo[] };
/** Day form: ?restaurant=&date=[&guests=]&lang= */
export type DayResponse = {
  restaurant: string; today: IsoDate; now: string; date: IsoDate; state: DayState; reason?: string;
  maxParty: number; leadMinutes: number; sameDayCutoff: string | null; periods: PeriodInfo[];
};
export type AvailabilityError = { error: 'restaurant_required' | 'restaurant_unavailable' | 'outside_window' | 'invalid_date' | 'unavailable' };
export type BookingRules = { windowDays: number; leadMinutes: number; sameDayCutoff: string | null; maxParty: number };
/** What resolveDay (engine, §10.1) hands the API, before bookings are counted. */
export type ResolvedDay = {
  date: IsoDate;
  closed: { reason: string | null } | null;
  periods: { meal: Meal; closed: { reason: string | null } | null; slots: { time: string; capacity: number }[] }[];
};
```

The real file has the same declarations with fuller doc comments.

HTTP status codes:
- 400 `restaurant_required`, `invalid_date` or `outside_window`.
- 404 `restaurant_unavailable` for an unknown restaurant or `booking_enabled = false`.
- 503 `unavailable` when the database fails.
- Every answer carries `cache-control: no-store`.
- Reading `request.url` makes the handler run per request (`node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md:89,124`).

### `lib/booking/plan.ts` (pure; the server builds answers with it and the browser reuses `closedByClock`)

```ts
import type { Meal } from '@/lib/data';
import { addDays, minutesUntil, toMinutes, venueNow, type IsoDate } from '@/lib/venue-time';
import type { BookingRules, DayInfo, DayState, PeriodInfo, ResolvedDay } from './types';

export function windowDates(today: IsoDate, windowDays: number): IsoDate[] {
  return Array.from({ length: windowDays }, (_, i) => addDays(today, i));
}
/** Within leadMinutes (phase 1 closes at exactly leadMinutes too), or today after same_day_cutoff. */
export function closedByClock(date: IsoDate, time: string, now: Date, rules: Pick<BookingRules, 'leadMinutes' | 'sameDayCutoff'>): boolean {
  if (minutesUntil(date, time, now) <= rules.leadMinutes) return true;
  if (!rules.sameDayCutoff) return false;
  const v = venueNow(now);
  return v.date === date && v.minutes >= toMinutes(rules.sameDayCutoff);
}
/** Keyed by meal too: v2 rows carry `meal` and two meals may share a time. */
export type HeldCovers = (meal: Meal, time: string) => number;
export type PlannedDay = { state: DayState; reason?: string; periods: PeriodInfo[] };
const withReason = (reason: string | null | undefined) => (reason ? { reason } : {});

export function planDay(resolved: ResolvedDay, held: HeldCovers, rules: BookingRules, now: Date, guests = 1): PlannedDay {
  if (resolved.closed) return { state: 'closed', ...withReason(resolved.closed.reason), periods: [] };
  const periods: PeriodInfo[] = resolved.periods.map((p) => {
    if (p.closed) return { meal: p.meal, closed: true, ...withReason(p.closed.reason), slots: [] };
    return { meal: p.meal, closed: false, slots: p.slots.map((s) => {
      const left = Math.max(0, s.capacity - held(p.meal, s.time));
      const bookable = !closedByClock(resolved.date, s.time, now, rules) && left >= guests && guests <= rules.maxParty;
      return { time: s.time, left, bookable };
    }) };
  });
  const serving = periods.filter((p) => !p.closed && p.slots.length > 0);
  if (serving.length === 0) {
    const reason = periods.find((p) => p.closed && p.reason)?.reason;
    return { state: 'closed', ...withReason(reason), periods };
  }
  const slots = serving.flatMap((p) => p.slots);
  const timely = slots.filter((s) => !closedByClock(resolved.date, s.time, now, rules));
  if (timely.length === 0) return { state: 'past', periods };
  if (timely.every((s) => s.left < 1)) return { state: 'full', periods };
  return { state: 'open', periods };
}
export function dayInfo(resolved: ResolvedDay, held: HeldCovers, rules: BookingRules, now: Date): DayInfo {
  const { state, reason } = planDay(resolved, held, rules, now);
  return { date: resolved.date, state, ...withReason(reason) };
}
```

### `lib/booking/client.ts` (pure browser rules; full file in the clone)

It exports:
- `BookingContext {restaurants (bookable only), calendar, board, now}`;
- `dayReason(d, words)`: the public reason, else `booking.day_full`, `booking.day_past` or `booking.day_closed`;
- `bookableRestaurants`;
- `calendarFor` (matches the restaurant) and `boardFor` (matches restaurant and date);
- `firstOpenDay`;
- `slotOpen(board, period, slot, guests, now)` = `!period.closed && slot.bookable && slot.left >= guests && guests <= board.maxParty && !closedByClock(board.date, slot.time, now, board)`;
- `openTimes`, `nearestOpenTime`;
- **`reconcileBooking(current, patch, ctx)`**:
  - a destination picks its first bookable restaurant;
  - a restaurant that does not book online is never chosen;
  - with the matching calendar, guests are clamped to `[1, maxParty]` and a date that is not open is refused, keeping the current date or falling back to the first open day;
  - with the matching board, the time slides to the nearest open slot;
- **`bookingOpen(ctx, b)`**: `null` when there is no matching board (the server decides), otherwise true or false.

### Server stub: `lib/server/booking/availability.ts` (`server-only`, uncached)

It reproduces phase-1 behaviour exactly: `SLOTS × restaurants.meals × slot_capacity`, every weekday, no closures, and the phase-1 constants as rules. Its pieces:
- `bookingRules()` returns `{14, 30, null, 12}`.
- `resolveDayStub()` is the stand-in for the engine.
- `heldCovers()` runs one `GROUP BY reserved_on, reserved_at` over the window with `status <> 'cancelled'`.
- `groupPhone(dest)` reads `destinations.phone_e164` and `phone_display` (migration 004), ordered by `(id = $1) DESC, sort_order`. A destination without a phone (`mm`) falls back to the resort line.
- `getCalendar(restaurant, locale, now, {from, to})`, `getDay(...)` and `partyLimit(id)` (for the action).

The engine spike replaces only `bookingRules` and `resolveDayStub`; `plan.ts`, the route and the client stay as they are.

### `app/api/availability/route.ts`

```ts
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const restaurant = params.get('restaurant');
  const lang = params.get('lang') ?? DEFAULT_LOCALE;
  const locale = LOCALE_CODE_RE.test(lang) ? lang : DEFAULT_LOCALE;
  const date = params.get('date');
  const now = new Date();
  if (!restaurant) return fail(400, 'restaurant_required');
  try {
    if (date === null) {
      const from = params.get('from') ?? undefined; const to = params.get('to') ?? undefined;
      if ((from && !isValidIsoDate(from)) || (to && !isValidIsoDate(to))) return fail(400, 'invalid_date');
      const answer = await getCalendar(restaurant, locale, now, { from, to });
      return answer.ok ? NextResponse.json(answer.data, { headers: NO_STORE }) : fail(answer.status, answer.error);
    }
    if (!isValidIsoDate(date)) return fail(400, 'invalid_date');
    const guests = Number(params.get('guests') ?? 1);
    const answer = await getDay(restaurant, date, Number.isInteger(guests) && guests > 0 ? guests : 1, locale, now);
    return answer.ok ? NextResponse.json(answer.data, { headers: NO_STORE }) : fail(answer.status, answer.error);
  } catch (err) { console.error('availability_failed', err); return fail(503, 'unavailable'); }
}
```

`submitReservation` (`app/actions.ts`) adds `params: {max, phone}` to `party_too_large` through `partyLimit()`. `check-reservation.ts` returns `restaurant_unavailable` when `!restaurant.bookingEnabled`.

## 3. Client prototype (SiteProvider, ReserveDrawer, BookingBar)

### SiteProvider

- **State:** `calendar: CalendarResponse|null`, `board: DayResponse|null`, `clockOffset`. The separate `today` state, the device-clock mount effect and `availability` are gone. `today` is now `calendar?.today ?? null`.
- **`bookable`** = `useMemo(restaurants.filter(r => r.bookingEnabled))`. The initial restaurant is `bookable.find(DEFAULT_RESTAURANT_ID) ?? bookable[0]`, as in spec §5.2 `site_settings.default_restaurant_id`.
- **Sequence-guarded loaders instead of nonce effects.** This keeps lint at baseline, and only the newest request of each kind can land:

```ts
const latest = useRef({ booking, calendar, board }); latest.current = { booking, calendar, board };
const calendarSeq = useRef(0); const boardSeq = useRef(0);
const context = useCallback((at: Date, over: Partial<BookingContext> = {}): BookingContext =>
  ({ restaurants: bookable, calendar: latest.current.calendar, board: latest.current.board, now: at, ...over }), [bookable]);
const loadCalendar = useCallback((restaurant: string) => {
  const seq = ++calendarSeq.current;
  getJson<CalendarResponse>(calendarUrl(restaurant, locale)).then((res) => {
    if (seq !== calendarSeq.current || !res.ok) return;
    const serverNow = new Date(res.data.now);
    setClockOffset(serverNow.getTime() - Date.now()); setCalendar(res.data);
    setBookingState((b) => reconcileBooking(b, {}, context(serverNow, { calendar: res.data })));
  }).catch(() => {});
}, [context, locale]);
const loadBoard = useCallback((restaurant: string, date: IsoDate) => {
  const seq = ++boardSeq.current;
  getJson<DayResponse>(dayUrl(restaurant, date, locale)).then((res) => {
    if (seq !== boardSeq.current) return;
    if (!res.ok) { if (res.status === 400) loadCalendar(restaurant); return; } // stale tab past midnight
    const serverNow = new Date(res.data.now);
    setClockOffset(serverNow.getTime() - Date.now()); setBoard(res.data);
    setBookingState((b) => reconcileBooking(b, {}, context(serverNow, { board: res.data })));
  }).catch(() => {});
}, [context, loadCalendar, locale]);
useEffect(() => { if (booking.restaurant) loadCalendar(booking.restaurant); }, [booking.restaurant, loadCalendar]);
useEffect(() => { if (booking.restaurant && booking.date) loadBoard(booking.restaurant, booking.date); }, [booking.restaurant, booking.date, loadBoard]);
```

- **`openReserve`:**
  - computes `next = reconcileBooking(latest.current.booking, preset, ctx)`, which drops a preset restaurant that does not book online;
  - then calls `loadCalendar(next.restaurant)` and `loadBoard(...)`. This replaces the device-clock "today" refresh, and the "next day moves Today forward" spec stays green.
- **Submit gate:** `bookingOpen(ctx, booking) !== false`.
  - When the gate fails, the error is `past` if `closedByClock` using the board's own `leadMinutes`/`sameDayCutoff`, otherwise `full`.
  - After a server error, both loaders run again.
- **Exposed in SiteState:** `bookable`, `today`, `days` (the last calendar received, so the strip does not blink when switching restaurant), `maxParty`, `groupPhone` (both only from the calendar that matches the restaurant), `board` (only the matching one), and `strings: ClientStrings`.
- `openRestaurant` does nothing for a card without a detail page whose restaurant does not book online.

### Strings

- `ClientKey = Extract<StringKey, \`error.${string}\` | \`booking.${string}\`>`.
- `CLIENT_KEYS` is a type-guarded filter over both prefixes. The guarded layout is unchanged: it still passes `getStrings(locale, CLIENT_KEYS)`.
- **New registry keys** (`screen: 'booking'`):
  - `booking.day_closed` "Closed";
  - `booking.day_full` "Fully booked";
  - `booking.day_past` "No more tables today";
  - `booking.day_note` "{date}: {reason}";
  - `booking.meal_closed` "Not available on this date.";
  - `booking.no_dates` "No dates are open for online booking. Please call us on {phone}.";
  - `booking.loading` "Checking tables…".
- **Error keys:**
  - new `error.closed` (spec §10.2 code; also added to `BOOKING_ERROR_CODES`);
  - `error.party_too_large` becomes "For more than {max} guests, please call us on {phone}." with `vars ['max','phone']`.
- `registry.test.ts` passes for every key.

### ReserveDrawer

- **`DayStrip` child component.** It is mounted only while the drawer shows, so its local note state resets without a set-state-in-effect warning. Each chip:
  - gets `data-state={state}`;
  - when the day is unavailable, gets `aria-disabled="true"` (it stays focusable so screen readers hear the reason) and `aria-label = "Sun, 4 Oct: Closed for a private event"`;
  - on a tap of an unavailable day, renders `<p class="day-note" role="status">` with the same text and does not select the day.
  - When no day in the window is open, `booking.no_dates` shows with a `tel:` link.
- **Guests:**
  - `+` is disabled while `maxParty === null`, or when `guests >= maxParty`.
  - At the limit, `<p class="guests-hint">` renders `error.party_too_large` with `{max}` filled in and `{phone}` as a `tel:` link (the `WithPhone` helper splits on `{phone}`).
- **Slots:**
  - "Checking tables…" shows while the board loads;
  - `error.closed` shows for a whole-day-closed board;
  - a closed meal keeps its heading and shows `booking.meal_closed` plus its reason;
  - otherwise the slots render as before through `slotOpen`.
- **CSS:** new selectors only, in `styles/overlays.css`:
  - `.day:is([data-state=closed|full|past])` uses the taken-slot look (`--disabled-line`, `--disabled-time`, struck-through `.day-num`, `cursor: not-allowed`);
  - also new: `.day-note`, `.guests-hint`, `.slot-loading`, `.slotgroup-note`, `.slotgroup-reason`.

### BookingBar

- Destination and restaurant options come only from bookable restaurants.
- Date options come from `days`. A day that is not open gets `disabled`, `note = state word` and `hint = reason`; `Dropdown`'s `Option` gained an optional `hint`, rendered as `title`.
- **Time and guests before the server answers:** until the board and `maxParty` arrive (and in the server HTML), the fields show a single placeholder option for the current value (`[{value: booking.time}]`, `[{value: booking.guests}]`). This keeps the server HTML at "Date — / Time 19:00 / Guests 2 guests", byte-for-byte what no-JS visitors saw before (checked with curl and by the no-JS visual baselines).

### RESERVE hidden when `booking_enabled = false`

- `TayaHero` drops RESERVE A TABLE.
- `MobileBar` drops RESERVE, and the grid loses that column (`1 + canReserve + tel + map`).
- `Offers` drops VIEW OFFER.
- `RestaurantCard` for a restaurant without a detail page drops its tag and gets `aria-disabled`.
- `SearchOverlay` drops the "Reserve" label.
- Generic RESERVE buttons stay; they open the drawer on a bookable restaurant.
- `Restaurant.bookingEnabled` is read by `listRestaurants`, which is cached under the `restaurants` tag, so the server HTML is correct without JavaScript.
- The stub migration `db/migrations/006_p4guest_booking_enabled_stub.sql` is one line: `ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS booking_enabled boolean NOT NULL DEFAULT true;`. The real phase-4 migration replaces it.

### Kept behaviour

- Server HTML has no date, so hydration stays clean (the Kiritimati hydration specs pass on both pages).
- Page-scoped DOM: the page-scope guard test passes. The drawer and bar live in Chrome, above the `<Activity>` pages.
- No-JS rendering is unchanged.
- Network: **2 requests on page load** (calendar, then day) instead of 1; switching restaurant also makes 2.
- A probe switching rapidly Dining House → Thai Siam → Hura Izakaya ended on Hura Izakaya (Dinner only, 14 days, Today selected) with no console errors.

## 4. Tests

### Existing tests that had to change (exact list)

- `e2e/booking-dates.spec.ts`: 4 inline `page.route` mocks returned the v1 shape and now call `mockAvailability()` from the new `e2e/availability-mock.ts`. The assertions are unchanged. The device-clock-behind test no longer makes a 400 round trip, because the calendar comes first.
- `e2e/visual.spec.ts`: its mock moved to the v2 shape (`mockAvailability(page, { today: () => '2026-10-05', now: () => FIXED_NOW.toISOString() })`). This is required: on `3c04ace` the old shape renders `—` for the date, and the old client crashes on the new shape. The baselines were not touched.
- `test/integration/availability.test.ts`: rewritten for v2, 11 tests:
  - calendar from Da Nang's today, with maxParty, groupPhone and `no-store`;
  - group-phone fallback for `mm`;
  - from/to narrowing;
  - the day form's meals and covers left;
  - `guests=13` gives no bookable slot;
  - 404 for an offline or unknown restaurant;
  - five 400 cases.
- `test/integration/submit-reservation.test.ts`:
  - `party_too_large` now carries `params: {max: '12', phone: '+84 236 651 9999'}`;
  - new case: a restaurant that books offline gives `restaurant_unavailable`.
- `lib/booking.test.ts`: the tests for removed helpers are gone (`bookingDates`, `defaultDate`, `unavailable`, `reconcile`); a `slotsFor` test is added.
- `lib/booking.test.ts` and `lib/server/check-reservation.test.ts` fixtures gained `bookingEnabled: true`.
- `filters.spec.ts`, `page-scope.spec.ts`, `nojs.spec.ts`, `navigation.spec.ts` and the admin specs needed **no change**.

### New tests

- `lib/booking/plan.test.ts` (10 tests):
  - window dates;
  - lead boundary and same-day cutoff;
  - whole-day closure with its reason;
  - a meal closure leaves the day open;
  - every meal closed gives `closed` with the first reason;
  - no periods gives `closed` with no reason;
  - `past`, `full`, `left`/`bookable` per party, and `maxParty`.
- `lib/booking/client.test.ts` (10 tests):
  - reconcile ignores an offline restaurant, picks the first bookable restaurant of a destination, clamps maxParty, refuses a closed date, moves a stale date to the first open day, slides the time to the nearest slot with room, and ignores a board for another date;
  - `bookingOpen` is `null` without a board, false or true otherwise;
  - `dayReason`.
- `e2e/booking-v2.spec.ts` (4 tests, `reducedMotion: 'reduce'`):
  - (a) **A closed day is greyed out, cannot be chosen, and says why.** It checks `aria-disabled`, `data-state`, the line-through, that a forced click leaves the selection on 2 Oct, that `role=status` shows the reason, the generic "Closed" and "Fully booked", that an open day still selects, and that the bar's Date option is disabled with `title` = the reason and note "Closed".
  - (b) A meal closure keeps the rest of the day bookable.
  - (c) **max_party 8**: + is disabled at 8, the hint reads "For more than 8 guests, please call us on +84 236 651 9999." with `href="tel:+842366519999"`, the hint goes away below the limit, and the bar offers exactly 8 options.
  - (d) A real booking through the stub, with no mocks: 14 days, Today first, a reference matching `^FC-[0-9A-HJKMNP-TV-Z]{8}$`.
- `e2e/booking-disabled.spec.ts` (3 tests): skipped unless `E2E_BOOKING_DISABLED=1` and the build was made after `booking_enabled = false` for taya-house and hai-van-lounge. Phase 4 should replace it with the admin toggle plus `updateTag`. It checks that 1 of 3 VIEW OFFER buttons remains, the Hải Vân card has no tag and is `aria-disabled`, the drawer starts on Café Indochine, the restaurant list has 4 resort entries without Tàya or Hải Vân, the detail page has no RESERVE A TABLE, and the phone tab bar has 3 columns.

### Results (all in the clone, local env prefix, ports 3230–3233)

- typecheck: passes.
- lint: exit 0 with **19 warnings** (baseline 20). The removed mount effect took away a set-state-in-effect warning, and nothing new was added.
- Unit tests without a database: 30 files passed, 13 skipped; 299 passed, 106 skipped.
- Integration subset on `furama_cuisine_p4guest_test` with `TZ=UTC` (availability, submit-reservation, catalogue, reservations and content-strings, plus everything under `lib` and `test/guards`): **34 files, 314 tests passed**. The migration-* integration files were not run, because they create fixed-name databases that other agents share.
- build: passes. `check-prerender`: passes (`/en` and `/en/restaurants/taya-house`, tags `restaurants, i18n:en, locales, content:ui`).
- **Full E2E: 74 passed, 3 skipped.** The 3 skipped are the env-gated spec. It was green 3 times in a row; the phase-3 baseline was 70.
- **Second build** with taya-house and hai-van-lounge set to `booking_enabled = false`: booking-disabled + booking-v2 + booking-dates + nojs = **16/16 passed**, including hydration.
- **Visual: 8 passed at maxDiffPixelRatio 0**, twice, on the default-seed build.
  - The booking UI appears in the booking bar of desktop/home, desktop/taya-house and phone/home (the phone detail page hides `.booking-slot`), and in their no-JS variants, which show "Date —".
  - The drawer appears in no baseline.
  - None of the baselines changed.
- **RED:** the 4 new booking-v2 tests fail on an untouched `3c04ace` build (4/4).

## 5. Conventions to keep

- Use `--reporter=list` and `--retries=0`.
- A click on an `aria-disabled` chip needs `{ force: true }`: Playwright treats `aria-disabled` as not enabled, while a real tap still lands because the button is not `disabled`.
- Scope status lookups to the dialog (`drawer.getByRole('status')`), because Next's route announcer is a separate live region.

## 6. Errors hit

1. **oxlint warnings rose from 20 to 23 after the first SiteProvider rewrite.** The new warnings were react(exhaustive-effect-dependencies) twice (calendarNonce and boardNonce were effect dependencies the body never read), react-hooks(exhaustive-deps) ('useMemo depends on `days`, which changes every render'), and react(set-state-in-effect) for the drawer's `useEffect(() => { if (!open) setDayNote(null) })`.
   - Cause: fetches were re-triggered by bumping a counter state listed only as an effect dependency. `calendar?.days ?? []` built a new array on every render. Resetting local state from an effect is flagged.
   - Fix: replaced the counters with useCallback loaders (loadCalendar and loadBoard), each guarded by a request sequence ref so only the newest answer lands. Effects and event handlers (openReserve, a failed submit, a 400 from the day form) call the loaders directly. Added a module-level `NO_DAYS` constant. Moved the day strip into a `DayStrip` child that mounts only while the drawer is open, so its note resets on unmount. Final lint: 19 warnings, one fewer than baseline.
2. **Playwright `locator.click: Test timeout ... element is not enabled` on the closed day chip.**
   - Cause: Playwright's actionability check treats `aria-disabled="true"` as disabled. The chip is deliberately aria-disabled rather than `disabled`, so it stays focusable, its reason is read out, and a tap reveals the reason.
   - Fix: `closed.click({ force: true })` and `option.click({ force: true })`, with a comment in the spec explaining why.
3. **On the untouched phase-3 build (RED run), every mocked v2 test lost the RESERVE button ('element was detached from the DOM').**
   - Cause: the v1 client reads `data.booked[time]` and `data.capacity`. A v2 response has neither field, so rendering throws and the [lang]/error.tsx boundary replaces the page. This is a real deploy-skew hazard: a tab opened on the old deploy breaks once the API shape changes.
   - Fix: not fixed in the spike; it is recorded as a risk. Options: Vercel Skew Protection; a new path; or treating requests without `lang` as v1 and answering the old `{today, now, date, booked, capacity}` shape for one release.
4. **A Python edit script asserted on a string that an earlier step in the same run had already duplicated, and aborted.**
   - Cause: the order of replacements inside the script was wrong (tooling only).
   - Fix: the script writes only after every replacement succeeds, so the file was untouched. Re-ran it with the removal before the insertion.

## 7. Package versions

- No packages installed or changed.
- next@16.3.7
- react@19.3.0 / react-dom@19.3.0
- typescript@7.0.2
- vitest@5.0.3
- @playwright/test@1.63.0
- oxlint@1.86.0
- pg@8.23.0
- Node v22.22.0 (local)
- Postgres local (furama_cuisine_p4guest_test, now dropped)

## 8. Recommended task breakdown (spike author)

Guest-side tasks for the phase-4 plan, in order. Each task ends with the full gate, and the visual run must stay at 8 passed with ratio 0.

1. **Shared contract.** Write `lib/booking/types.ts` and `lib/booking/plan.ts` (windowDates, closedByClock, planDay, dayInfo) with unit tests. Take them verbatim from the spike. Agree with the engine task that resolveDay returns `ResolvedDay` and held covers come as `(meal, time) => number`.
2. **Availability API v2.** Rewrite `app/api/availability/route.ts` to serve both forms and the error codes, built from the engine's resolveDay, the rules from booking_settings plus overrides, held covers, and the group phone (restaurant, else destination, else the first destination with a phone).
   - Rewrite the integration test.
   - Decide the skew mitigation in this task (see risks).
3. **Catalogue and server action.**
   - Add `Restaurant.bookingEnabled`; `meals` comes from active service_periods, under the `restaurants` and `booking-rules:<id>` tags.
   - In check-reservation, `booking_enabled = false` returns restaurant_unavailable.
   - submitReservation returns `party_too_large` with params `{max, phone}` and adds the `closed` code.
   - Update the submit-reservation integration test.
4. **Registry.**
   - Add the `booking.*` keys (screen 'booking') and `error.closed`.
   - Rewrite `error.party_too_large` with vars `{max}` and `{phone}`.
   - Add the `ClientKey` type and the `CLIENT_KEYS` filter.
   - Check content_strings on Neon for an existing `error.party_too_large` row: an old override without `{max}`/`{phone}` would hide the limit.
5. **Client logic.**
   - Add `lib/booking/client.ts` with unit tests.
   - Rewrite SiteProvider: sequence-guarded loadCalendar/loadBoard, `bookable`, the context exposing days, maxParty, groupPhone, board and strings.
   - Delete the dead helpers in `lib/booking.ts` and their tests.
6. **Drawer, bar and CSS.**
   - ReserveDrawer: DayStrip with greyed, aria-disabled chips and the reason note; the guest limit with a tel: link; meal closures; the loading line.
   - BookingBar: placeholder options keep the server HTML unchanged.
   - Dropdown `hint`; new CSS selectors only.
7. **RESERVE visibility.** TayaHero, MobileBar (column count), Offers, RestaurantCard (product decision needed, see questions), SearchOverlay, openRestaurant.
8. **E2E.**
   - Add the `e2e/availability-mock.ts` helper; move booking-dates.spec.ts and visual.spec.ts mocks to it.
   - Add booking-v2.spec.ts: closed day, meal closure, max party 8, real booking.
   - Once the admin screens exist, add database-backed acceptance specs using staff-fixtures `db()`:
     - an admin closure makes the guest's day grey at once (availability is not cached);
     - an Editor changes dinner time and capacity and the guest's slots change at once;
     - setting max_party = 8 blocks the 9th guest, and the server action rejects 9;
     - switching booking_enabled off with `updateTag('restaurants')` removes the RESERVE buttons. This replaces the env-gated spike spec.

## 9. Risks and open questions

- **Deploy skew (verified):** a browser still running the phase-3 client crashes into [lang]/error.tsx as soon as /api/availability answers in the v2 shape. Pick one before shipping: (a) turn on Vercel Skew Protection; (b) for one release, answer the old shape when there is no `lang` (old clients never send it); (c) give v2 a new path.
- **Two availability requests per page load** (calendar, then day) instead of one, and two on every restaurant switch. They are small `no-store` queries. Combining them (a calendar answer that also carries the first open day's board) is possible but goes beyond the spec's two forms.
- **Lead-time boundary:** phase 1 and the spike close a sitting when `minutesUntil <= lead_minutes`, but spec §10.1 says it is bookable when at least lead_minutes remain (>=). They disagree at exactly 30 minutes. The engine owner should settle it, and `closedByClock` follows.
- **Day-state semantics need ratifying:** state is computed for a party of one. 'full' means no covers at all; 'past' means today with every sitting closed by lead time or cutoff. Full and past days are greyed and not selectable, like closed days. Phase 1 let guests pick them and then showed 'No tables left'.
- Held covers are keyed by time only, because phase-1 rows have no `meal`. Once reservations.meal exists, key by meal + time. The `HeldCovers(meal, time)` signature is ready for that.
- Two meals sharing a time (Drinks and Dinner at 18:00–21:00) would produce duplicate React keys in the bar's Time dropdown and an ambiguous `booking.time`. This is pre-existing; no seeded restaurant has both meals. The engine and service_periods should forbid overlapping slots, or the booking should carry the meal.
- **Group-phone fallback (open question):** mm has no phone, so the spike falls back to the first destination with one (the resort line). Is that acceptable, or should the hint fall back to site_settings.email? Phase 6 adds restaurants.phone_*.
- **Restaurant card behaviour (open question):** a card without a detail page whose restaurant books offline is rendered with no tag, `aria-disabled`, and a click that does nothing. Product could prefer a 'Call to book' action instead.
- Generic RESERVE buttons (Header, Menu, home tab bar, FIND A TABLE) stay even if no restaurant books online. The drawer would then be empty. Hide them when `bookable.length === 0`?
- Changing the `error.party_too_large` default and adding `{max}`/`{phone}`: any content_strings override written against the old text would lose the variables. Also consider extending the guard test so DB overrides must keep the declared vars.
- Existing hard-coded English in the booking UI ('Today', 'Tomorrow', 'Full', 'N left', 'No tables left on this date…', aria labels, 'RESERVE A TABLE') is not in the registry. Spec §14 phase 7 owns that move; the spike added only new strings to the registry.
- The spike added migration 006_p4guest_booking_enabled_stub.sql only so the column exists. The real phase-4 migration must add `booking_enabled` with the same name and default, or catalogue reads break.
- The calendar `days` shown are the last answer received, even for the previous restaurant, to avoid a blank strip. For a few hundred milliseconds after a switch, a day that is closed only for the new restaurant can look open. reconcileBooking corrects the selection when the right calendar arrives.
- Submitting before the day's board has loaded skips the client gate (`bookingOpen` returns null) and leaves the decision to the server. That is acceptable because the server re-checks everything.
- Not covered by this spike: the ledger's phase-4 items (`unstable_rethrow` in actionError, `clientIp()` extraction, /admin/audit keyset paging, showing the email for the staff_invitation entity), and the phase-2 ledger's deferred E2E for the SearchOverlay View/Reserve label (it now also depends on bookingEnabled).
- Migration-* integration tests use fixed database names shared by concurrent agents, so this spike did not run them. The orchestrator's fix and verify step should run the whole Vitest suite alone.

## 10. Spec deviations (spike author)

- `now` is an ISO instant instead of `nowMinutes` in both forms, keeping the phase-1 deviation already noted in spec §10.2.
- Range form: `from` and `to` are optional and default to the whole window, which never moves. The client sends only `restaurant` and `lang`.
- Day form: the client never sends `guests`. Each slot carries `left`, and the browser checks the party against it, so the stepper does not trigger requests. The server still accepts `guests` and applies it to `bookable`.
- Both responses carry fields the spec does not list. The range form adds `restaurant` and `groupPhone`. The day form adds `restaurant`, `today`, `now`, `state`/`reason`, `maxParty`, `leadMinutes` and `sameDayCutoff`, so the open form can close sittings with the server's own rule.
- Day states are open, closed, full and past. The research note's 'outside' is not needed, because every listed day is inside the window by construction.
- HTTP status codes were chosen by the spike (the spec gives none): 404 for restaurant_unavailable (unknown or booking_enabled = false); 400 for restaurant_required, invalid_date and outside_window; 503 for unavailable.
- The text of `error.party_too_large` changed and it gained vars {max} and {phone}. The client reuses it as the stepper hint at the limit.
- The group phone falls back to another destination's number when the restaurant's destination has none. The spec says 'the restaurant's phone', which arrives in phase 6.
- booking_enabled = false also strips the 'Reserve a table' action from cards without a detail page, the Offers 'VIEW OFFER' button, and the search result label. The spec names only the RESERVE buttons and the form list.
- Stub migration 006_p4guest_booking_enabled_stub.sql (spike only). It must be replaced by the real §5.2 booking migration.
