# Phase 4 plan outline: Đặt bàn v2 (booking rules, availability engine, guest form, lifecycle, reservations admin)

Scope: spec `docs/superpowers/specs/2026-10-01-admin-cms-design.md` §14.1 row 4, with the details in §5.2 "Đặt bàn (đợt 4)", §6.2–6.3, §7.1 (reservation, closure and booking-settings rows), §7.2, §7.4, §10.1–10.3, §11–§13 and §16. `notification_recipients` and `email_outbox` stay in phase 5; nothing in this outline needs them.

Folder: `/Users/bcmac/Desktop/projects/Outside Projects/furama_cuisine/docs/superpowers/research/2026-10-02-phase-4-spikes/`. It holds this outline and three spike reports:
- `booking-engine.md` (clone `p4-engine`, patch `p4-engine.patch`): migration 006, `resolveDay`, API v2, transactional `submitReservation` v2, cache behaviour.
- `guest-booking-ui.md` (clone `p4-guest`, patch `p4g-guest.patch`): the guest form on server availability.
- `reservations-admin.md` (clone `p4-admin`, commit `e274649`): lifecycle, admin screens, settings, closures, audit feed, the phase-3 deferred items.

Where a report and this outline disagree, **this outline wins**. §0 lists every conflict and how it was settled.

## 0. What I checked myself, on top of the three reports

**State**
- The repo is untouched. HEAD is `3c04ace`, and `git status` shows only this folder as untracked.
- Nothing listens on ports 3200–3299. No `p4*` database is left on the local Postgres; only the pre-existing `furama_cuisine_{test,e2e_test,migrate_test,migrate004_test,migrate005_test}` (and other projects' databases) remain.
- Clones:
  - `p4-engine`: 44 changed files, uncommitted on `3c04ace`.
  - `p4-guest`: 34 changed files, uncommitted on `3c04ace`.
  - `p4-admin`: branch `p4-admin-spike`, with `e274649` (the spike) and `5fd78c3` (per-agent database names, **never copy**).
- I did not re-run any build or test. I settled the conflicts by reading the clones, HEAD, the spec and `node_modules/next/dist/docs`.

**Facts at HEAD that the decisions rest on**

| # | Fact | Where |
|---|---|---|
| F1 | Each migration file runs once (tracked in `_migrations`) inside its own `BEGIN … COMMIT`. `--until <file>` stops after a file. A failing 006 rolls back completely. | `scripts/migrate.mjs:25-30,46-70` |
| F2 | "The site has never been deployed, so there is no live traffic to break today." No browser runs the phase-3 client. | `README.md:86-91` |
| F3 | Phase 1 closes a sitting when `minutesUntil <= LEAD_MINUTES`. `venueNow` formats hours and minutes only, so the venue clock is truncated to the minute. | `lib/booking.ts:55-57`; `lib/venue-time.ts:11-25` |
| F4 | `npm test` already runs `TZ=UTC vitest run`. `next start` for E2E runs in the machine's zone (+0700 here); Vercel runs in UTC. | `package.json:11` |
| F5 | Permission statement: `reservations: [read, update, create, note, configure, auto-confirm, purge-test]`, `schedule: [read, update]`, `settings: [read, update]`. The Editor lacks `auto-confirm`, `purge-test`, `settings:*` and `audit:read`. | `lib/server/auth/permissions.ts:18-20,30-41` |
| F6 | `actionError` has no `unstable_rethrow` and `ActionFailure` has no `params`. X-Forwarded-For is parsed twice. The guard's `ADMIN_ONLY_ACTIONS` lists only `users/actions.ts`. | `lib/server/action-result.ts:23-31`; `lib/server/dal/session.ts:55`; `app/admin/(auth)/accept-invite/actions.ts:42`; `test/guards/require-permission.guard.test.ts:43` |
| F7 | `TAGS.restaurants` and `TAGS.bookingRules(id)` exist. `getRestaurants(locale)` is `'use cache'` + `cacheLife('max')` + tags `restaurants`, `i18n:<locale>`. No reader is tagged `booking-rules:<id>`. | `lib/cache-tags.ts`; `lib/server/content/restaurants.ts:14-19` |
| F8 | The `pg` pool has `max: 5`. | `db/client.ts:38-40` |
| F9 | 12 restaurants; the meal arrays add up to 25 services. Destination phones: resort `+84 236 651 9999`, dining-house `0859 555 759`, mm and future none. | `db/migrations/002_seed_restaurants.sql:5-17`; `004_…sql:85-91` |
| F10 | `DEFAULT_RESTAURANT_ID = 'taya-house'`, the only restaurant with a detail page. Playwright has one project (`desktop`); spec files run in parallel workers; CI retries once. | `lib/data.ts:27`; `playwright.config.ts` |
| F11 | `updateTag` works only inside a Server Action. `updateTag`/`refresh` re-render the current route inside the action's response. Runtime `'use cache'` entries "typically don't persist" on serverless, and revalidation is per instance by default. A GET handler that reads `request.url` runs per request. `unstable_rethrow` goes first in the catch. | `04-functions/updateTag.md:12`; `02-guides/server-actions.md:144-148`; `01-directives/use-cache.md:247-252`; `02-guides/how-revalidation-works.md:55-57`; `01-getting-started/15-route-handlers.md:89,122`; `04-functions/unstable_rethrow.md:59-62` |
| F12 | Phase-2 ruling 7: once a guest tag is expired, a request-time render with the database down answers a raw 500. No phase so far expired a guest tag; phase 4 does (`updateTag('restaurants')`). | `docs/superpowers/plans/2026-10-01-phase-2-guest-restructure.md:237,5382` |
| F13 | Phase-0 research (§4 step 5) proposed `minutesUntil >= lead_minutes`, and rated pg_trgm on Neon as "likely" available. | `research/2026-10-01-admin-cms/reservations-domain.md:325-331,596` |

**Conflicts between the spikes, and the decision for each**

| # | Conflict | Decision | Evidence |
|---|---|---|---|
| C1 | **Two migration 006 prototypes.** The engine's `006_booking_v2.sql` versus the admin's `006_reservations_v2.sql`. | One file, **`006_booking_v2.sql`**, with the engine's file as the base. From the admin, it takes `fold_search()` and a single trigger `reservations_before_write` (BEFORE INSERT OR UPDATE) that maintains `search_text`, `version` and `updated_at`. That trigger replaces the engine's `reservations_touch` and its app-side `search-text.ts`. `search_text` also gets `lower(reference)` and the national phone form `0…` (the engine's ideas). The legacy backfill runs **before** the trigger exists, through a shared IMMUTABLE `reservation_search_text(…)`, so phase-1 rows keep `version = 1` and `updated_at = created_at`. Indexes: the admin's `reservations_created_idx` and `pending_idx (…, id)`, the engine's `phone_idx (phone_e164, reserved_on)`, and `service_periods_restaurant_idx (restaurant_id, sort_order)`. `window_days` is 1–90 (the engine's bound; the admin's zod moves to 90). The engine's `reservations_over_capacity_check` is dropped (R8). Other choices are listed in R7. | engine `migration-006.test.ts` (17) and admin's (4); admin error 5 (005's view re-run); engine errors 2–4 |
| C2 | **Three `resolveDay`s.** The engine's `lib/booking/resolve-day.ts`, the admin's `lib/reservations/resolve-day.ts`, and the guest's `lib/booking/plan.ts`. | The engine's is canonical. Online checks (guest API, `submitReservation`) use `resolveDay`. **Staff paths use the clock-free `planDay` plus held covers**: new booking, edit, slot preview, day sheet, affected lists. The engine's `resolveDay` returns no periods for `outside` and `unavailable` days, and staff must be able to book past the window and on a restaurant whose online booking is off. The guest's `closedByClock` becomes an exported `clockBlock(date, time, now, rules) → 'lead' \| 'cutoff' \| null`, used by `resolveDay` and by the browser. Dropped: the admin's `lib/reservations/resolve-day.ts` (`findOpenSlot`, `misfit`, `closureCovers` map onto `findSlot`, `planDay` and `closureApplies`), and the guest's `plan.ts` and `types.ts`. | engine: 28 tests and 6 boundary mutations, seed equivalence over more than 5000 verdicts; admin §5 (staff bypass the window) |
| C3 | **Rule loaders.** The engine has one `json_agg` query per restaurant (effective rules, active periods, closures with the localised reason). The admin uses `loadDay` (4 sequential queries) plus config reads with tokens. | The engine's `loadBookingRules`, generalised to `(db, restaurantIds[], locale, from)` returning a Map. It feeds every `resolveDay`/`planDay` call. `from` is the earliest date of interest, so closures with `ends_on >= from` are included and a staff action on yesterday still sees yesterday's closures. The closure-reason join also requires `locales.is_enabled`. The admin's config reads (raw overrides, inactive periods, µs tokens) stay, but only for the edit screens. | engine §4; admin §7; phase-2 ledger Task 10 (`loadStrings` lacked `is_enabled`) |
| C4 | **Advisory lock key.** The engine uses `'booking:'\|\|id\|\|':'\|\|date` with `lock_timeout 5s`; the admin uses `'reservations:<id>:<date>'` without a timeout. | **One function**, `lockBookingDay(client, restaurantId, date)` in `lib/server/booking/lock.ts` (the engine's key and timeout). Guest submit, staff create and staff edit call it. With two different keys, guest and staff writes would never serialise. **No spike tested a guest write against a staff write**, so T8 adds that cross-path test. | engine create.ts; admin §5 |
| C5 | **API contract.** The engine's `AvailabilityDays`/`AvailabilityDay` (7 states, `block`, 404 only for an unknown restaurant, 200 `outside`) versus the guest's `CalendarResponse`/`DayResponse` (4 states; `restaurant`, `groupPhone`, `leadMinutes`, `sameDayCutoff`; 404 for an unknown or disabled restaurant; 400 `outside_window`). | A merged contract (R4) in `lib/booking/api.ts`, using the guest's type names and field set, the engine's states and `block`, and the HTTP rules in R4. The client reloads the calendar when a day answer says `state: 'outside'`; this replaces its "on 400" path. | engine availability.test (18); guest availability.test (11) and client.test |
| C6 | **Overlap rule.** The engine rejects overlapping **ranges** on save; the admin rejects a **shared slot time** on a shared weekday, across the whole list. | The admin's rule. It is the exact invariant that keying capacity by time needs (R6). `planDay`'s dedupe stays as a second line of defence. | admin `overlappingPeriods`; engine `planDay` |
| C7 | **Config writes.** The engine's `schedule.ts` edits one period at a time with that period's `updated_at`; the admin's `config.ts` saves the whole list with a µs token on `restaurants.updated_at`, plus rules, auto-confirm, settings and closures. | The admin's `config.ts`, plus the engine's grid refine in zod ("the span is a multiple of the interval"). Without it the DB CHECK `service_periods_grid` would surface as `db_error`. Audit entities follow the admin: `service_periods/<restaurantId>`, `restaurant_booking`, `booking_settings`, `closure`. | admin §7, booking-config.test; engine migration grid CHECK |
| C8 | **Affected reservations.** The engine's `listAffectedReservations` covers one restaurant; the admin's `findAffected` covers many restaurants and has a closure mode. | The admin's `findAffected`, rebuilt on `planDay`/`closureApplies`. It lists `requested` and `confirmed` bookings whose sitting has not started, and counts covers over every holding status. | admin §6 (4 verified cases); engine affected E2E |
| C9 | **The guest write path after 006.** The admin patched `db/queries.ts createReservation` minimally; the engine replaced it with `lib/server/booking/create.ts`. | The engine's `create.ts`. The admin's patch is only T1's bridge, and T4 deletes it. | admin error 3 (`$4::text::time`) |
| C10 | **Testing `forbidden()` and parsing the client IP.** The engine hand-builds the 403 digest error and takes the first XFF entry; the admin uses `vi.stubEnv('__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS','1')` with the real `forbidden()`, and `clientIp` checks `isIP` and rejects zone ids. | The admin's versions for both. | admin errors 6 and 8; phase-3 ledger (IPv6 zone id) |
| C11 | **`error.party_too_large`.** The engine's "Please choose between 1 and {max} guests." with params `{max}`, versus the guest's "For more than {max} guests, please call us on {phone}." with vars `{max, phone}`. | The guest's text and vars, which match spec §10.2 ("kèm số điện thoại nhà hàng"). The action returns `params: {max, phone}`, with the phone taken from the loader's `groupPhone`. | guest registry diff; spec §10.2 |
| C12 | **Catalogue.** Both spikes add `Restaurant.bookingEnabled`. Neither derives `meals` from periods, although spec §6.3 item 2 says to "từ đợt 4". | T5 adds both: `bookingEnabled`, and `meals` = the distinct meals of active periods in canonical order. The catalogue is still cached under `restaurants`, and period saves already expire that tag. | spec §6.3.2; F7 |
| C13 | **E2E toggles of shared state.** The engine switched `taya-house` off inside the parallel run; the guest used an env-gated second build. | Specs that change state every page reads (the booking switch on Tàya, the only detail page) go in a second Playwright project `desktop-serial` with `dependencies: ['desktop']`, so they run after every other spec. Every other spec owns its own restaurant×date pairs (§4.10). **Unverified:** the dependent project; the T11 draft proves it. | F10; engine E2E test 3; guest `booking-disabled.spec.ts` |
| C14 | **Audit keyset.** The engine suggested `(at, source, lpad(id))`; the admin built `(at, source, id::bigint)` with a µs cursor. | The admin's version. | admin EXPLAIN 0.05 ms at 200k rows; µs-tie test fails with ms precision |
| C15 | **The `created` event for legacy rows.** The engine uses `actor_kind 'system'`, label `migration 006`; the admin uses `'guest'` with a Vietnamese label. | The engine's. A migration is not a guest. | engine migration test |
| C16 | **Default for `reservations.source`.** The engine drops the default; the admin's trick sets `'web'`. | No default. Every insert names its source, and a raw fixture that forgets fails loudly. The site has never been deployed, so no phase-3 writer remains to need a default (F2, R1). | engine; F2 |
| C17 | **Event types.** The admin's CHECK already lists `email_queued`, `email_sent`, `email_failed`. | Four types only (`created`, `status_changed`, `edited`, `note_added`) under the named constraint `reservation_events_type_check`. Phase 5 replaces that constraint together with its labels; it may also want `email_skipped`. | spec §10.4 outbox statuses |
| C18 | **Module layout.** Engine: `lib/booking/*` sits beside the file `lib/booking.ts`. Admin: `lib/reservations/*`, `lib/server/booking/{rules,reservations,config,queries,affected}.ts`. Guest: `lib/booking/{types,plan,client}.ts`. | `lib/booking/{rules,resolve-day,slot-code,api,client}.ts` (isomorphic); `lib/reservations/{lifecycle,search}.ts` (isomorphic); `lib/server/booking/{rules,lock,input,create,reservations,config,queries,affected}.ts`. `@/lib/booking` keeps resolving to the file. Never add `lib/booking/index.ts`. `HOLDING_STATUSES` and `RESERVATION_STATUSES` live only in `lib/booking/rules.ts`; `lifecycle.ts` imports them. | engine build (file and folder side by side pass tsc and Turbopack) |

## 1. Verified decisions

"Unverified" marks a piece that no spike ran in the merged form. The T-number is the task in §3 whose tests pin it.

**§14.1 row-4 deliverables**

| Item | Approach | Source | Pinned by |
|---|---|---|---|
| **Migration đặt bàn** | `006_booking_v2.sql` (C1, R7). Expand only, one transaction, `CREATE EXTENSION IF NOT EXISTS pg_trgm`. A `DO $$` pre-check names malformed `reserved_at` rows. Phase-1 rows become `source 'legacy'`, `is_test`, meal backfilled, with a `system` `created` event. **Unverified:** the merged file. | engine §2; admin §1 | T1 `test/integration/migration-006.test.ts`: every constraint by name, the trigger (one version bump per UPDATE; NULL `search_text` once anonymised), `fold_search` agreeing with JS `fold` on a fixed list, legacy rows, abort on a bad `reserved_at`, idempotent re-run. `migration-005.test.ts` runs `--until 005_staff_auth_audit.sql`. |
| **Ca phục vụ** | `service_periods` as the weekly template. The seed equals today's behaviour: `SLOTS` × `restaurants.meals` × `slot_capacity`, all weekdays, sort order 10/20/30/40 (Breakfast, Lunch, Drinks, Dinner). CHECKs: no crossing midnight; whole minutes; last seating on the interval grid. | engine (seed mutations caught) | T2 `test/integration/booking-seed.test.ts`: per restaurant and weekday, the `[meal, time, capacity]` list equals phase 1, plus more than 5000 verdicts. The phase-1 rule is inlined in the test, so T6's deletions cannot break it. |
| **Ngày đóng cửa (data)** | `closures` (scope all/destination/restaurant, inclusive dates, `meals` NULL = whole day) → `closure_i18n.public_reason`, shown when `show_reason` is on. The reason is the reviewed row, or the machine row when `serve_machine` is on, in an enabled locale; otherwise the default locale. | engine resolve-day + availability tests; admin booking-config | T2 resolve-day.test (whole day, inclusive end, scope, single meal, all meals, hidden reason); T3 `booking-rules.test.ts` (locale, `serve_machine`, disabled locale) |
| **Quy tắc đặt bàn** | `booking_settings` has one row. A NULL restaurant override inherits. `same_day_cutoff` is global only. `booking_enabled` is the single switch. | engine loader; admin `effectiveRules` | T3 booking-rules.test; T4 (per-restaurant `auto_confirm`, `max_party` 8); T12 |
| **Engine availability** | `lib/booking/resolve-day.ts`: `planDay` (spec §10.1 steps 1–3: weekday, closures, slots, dedupe), `clockBlock`, `resolveDay` (step 4: closed → lead → cutoff → party → full, plus window and `unavailable`), `findSlot`, `resolveRange`. `slot-code.ts` maps a day and a time to a guest error code. Pure and isomorphic. | engine | T2 `resolve-day.test.ts` and `slot-code.test.ts`. RED = the six boundary mutations (lead `<=`→`<`, cutoff `>=`→`>`, window `>=`→`>`, capacity `>`→`>=`, closure end inclusive, destination scope). |
| **API** | `/api/availability`, range and day forms per R4. Uncached: it reads `request.url` and answers `no-store`. Two queries: rules (`json_agg`) and covers (`GROUP BY` on `reservations_load_idx`). | engine (18 tests); guest (11) | T5 `availability.test.ts` v2 |
| **Guest form uses server slots and shows closed days** | Guest spike client: sequence-guarded `loadCalendar`/`loadBoard`; "today" and the clock offset from the server. `DayStrip` chips get `aria-disabled` (still focusable), `data-state`, the reason in the `aria-label` and a `role=status` note on tap. The guest stepper stops at `maxParty`, with an `error.party_too_large` hint and a `tel:` link. Meal closures keep their heading and show a note. `BookingBar` uses placeholder options, so the server HTML stays byte-identical. Only bookable restaurants appear in the lists. | guest (74 E2E, visual 8/8 twice, RED 4/4 on HEAD) | T6 `lib/booking/client.test.ts`, `e2e/booking-v2.spec.ts`, `booking-dates.spec.ts`, visual at ratio 0 |
| **`submitReservation` v2** | Spec §10.2 steps 2, 3, 4, 6 (lock, recompute, INSERT, `created` event) and 7 without the outbox. zod input (`unknown`) → E.164 → one transaction: `lockBookingDay` → `loadBookingRules` → `loadBookedCovers` → `resolveDay` → `slotVerdict` → INSERT (`source 'web'`, meal from the slot, locale falling back to the default, `confirmed` when `auto_confirm`) → `created` event (`actor_kind 'guest'`). `reservations_reference_key` → retry (3); `reservations_dedupe_v2_idx` → `duplicate`. | engine (14 tests ×5 runs) | T4 `submit-reservation.test.ts`. RED: without the lock, the 12-way race and the lock-holder test fail every run. |
| **Vòng đời trạng thái** | `lib/reservations/lifecycle.ts`: `TRANSITIONS` with time windows (R9) and `availableTransitions`. `transitionReservation`: `UPDATE … WHERE id AND version AND status = ANY(<froms open now>)` + `status_changed` event. Zero rows → `conflict {by, at}` from the latest event. `ReservationEffects` hooks run inside the transaction (phase 5 adds the outbox there). | admin (19 tests) | T8 `lifecycle.test.ts`, `reservation-lifecycle.test.ts` |
| **Hộp thư** | Tabs Cần xử lý / Hôm nay / Sắp tới / Tất cả. Keyset with 30 per page. Search: an exact reference (`normalizeReference`), an exact `phone_e164`, else `search_text LIKE fold_search(q)` (trigram). Inline "Xác nhận". | admin (EXPLAIN; 65-row paging) | T9 `reservation-inbox.test.ts`, `search.test.ts`, E2E |
| **Chi tiết** | Facts; transition buttons disabled outside their window, with a hint; edit (lock + capacity when the booking moves or grows); internal notes; timeline. | admin | T9 E2E (confirm, cancel with reason, windows, two-browser conflict) |
| **Tạo mới** | phone → `confirmed`, walk-in → `seated` (service day only). Slots come from `planDay` + covers. An over-capacity reason is required past capacity. Guest locale select. `redirect()` inside the `try` (R13). | admin | T10 E2E (refused as `full`, values kept, then saved with a reason; row: source phone, `over_capacity`, locale vi) |
| **Theo ngày** | Day sheet per restaurant and service with booked/capacity, guest and staff notes, and bookings outside the current hours; print CSS; `PrintButton`. | admin | T10 E2E (`emulateMedia print`) + `daySheet` integration |
| **Ngày đóng cửa (screen)** | CRUD with EN and VI reasons, audit `closure`, a per-closure affected list, batch cancel per booking (skips changed ones). Expires `booking-rules:<id>` for the old and new scope, then `refresh()`. | admin | T13 booking-config (closures) + E2E |
| **Giờ và sức chứa** | `/admin/restaurants/[id]/booking`: rules form (`booking_enabled`, overrides), `PeriodsEditor` (one list, one token, overlap rule, grid refine), slot preview via `planDay`, affected list. Saves call `updateTag('restaurants')` and `updateTag('booking-rules:<id>')`. | admin E2E; engine negative control (without `updateTag`, `/en` keeps the old catalogue) | T11 booking-config + E2E |
| **Cài đặt đặt bàn** | `/admin/settings/booking` and the per-restaurant `auto_confirm`, each in an Admin-only action file. | admin (guard mutation: 2 failures) | T12 guard + E2E (Editor 403; replayed POST → `forbidden`, no audit row) |
| `booking_enabled` on the guest site | Hides RESERVE entry points for that restaurant (R14) and drops it from the form lists; the API answers 404 and the action `restaurant_unavailable`. | engine E2E; guest second build (16/16) | T5 catalogue.test + availability 404; T4 action; T11 E2E (`desktop-serial`) |
| `meals` from active periods (§6.3.2) | `listRestaurants` derives `meals` from active `service_periods`. **Unverified.** | spec | T5 `catalogue.test.ts`: deactivating Lunch drops it |
| `audit_feed` (§7.4) | The 006 view: `audit_log` UNION ALL `reservation_events`, keeping 005's 11 columns in order. Reservation writes go only to `reservation_events`. | engine + admin | T1 migration test; T7 `audit-feed.test.ts`; T8 "a transition writes no audit_log row" |
| Deferred: `unstable_rethrow` | First line of `actionError`. | admin (RED verified) | T7 `action-result.test.ts` (redirect, notFound and forbidden pass through) |
| Deferred: `clientIp()` | `lib/server/client-ip.ts`, used by the DAL and accept-invite. | admin | T7 `client-ip.test.ts` |
| Deferred: `/admin/audit` keyset + invitation email | `listAuditFeed({before, after})`, cursor `<µs>_<source>_<id>`, `?truoc=`/`?sau=`; `entityLabels` (staff email, invitation email, reservation reference). | admin (EXPLAIN 0.05 ms) | T7 `audit-feed.test.ts` + `admin-audit.spec.ts` |

**Acceptance criteria (§14.1 row 4)**

| Criterion | Approach | Pinned by |
|---|---|---|
| **A1. Concurrent bookings never exceed capacity** | Every write that takes covers runs `lockBookingDay` first, then reads rules and covers inside the same transaction. A transaction takes at most one booking-day lock. Rules saves do not take it (R12). | T4: 12-way race for the last 6 covers books exactly 3 parties (sum 16); a second pool holding the lock keeps the action pending for more than 300 ms, then it answers `full`. T8: 8 staff parties of 3 against 16 covers → exactly 5. **New in T8: cross-path tests** (a staff create waits on a guest-held lock, and the reverse). T14: a burst of replayed Next-Action POSTs through `next start` never oversells (**unverified**). |
| **A2. Closed days greyed out for guests** | Range form `state: 'closed'` with the reason; `DayStrip` and the bar's Date options are disabled and give the reason. | T6 booking-v2: mocked closed day; a DB-backed closure inserted with `db()` greys the day on the next calendar fetch (availability is uncached). T13: a closure created in the admin greys the guest's day, with the public reason. |
| **A3. Confirm, cancel, no-show work correctly** | One transition function, version-checked, with the windows in R9. | T8 windows (17:59 too_early / 18:00 ok for seated; 19:14 / 19:15 for no-show; correction 00:30 ok / 04:00 too_late, on a UTC clock), racing transitions, a stale version. T9 E2E: confirm, cancel with reason, no-show on yesterday's sitting, disabled buttons with hints, two-browser conflict. |
| **A4. An Editor changes dinner time and capacity; the guest sees new slots immediately** | Availability and rules are never cached (R2); the catalogue's `meals` is expired by `updateTag('restaurants')`. | T5: a DB change shows in the very next API answer. T11 E2E: the Editor saves Thai Siam dinner (last seating 22:00, 8 covers) → the preview updates in the same response → a guest opens the drawer and sees 22:00 with "8 left". The engine checked this through the API only, so the browser half is **unverified**. |
| **A5. `max_party` = 8 makes the form block 9 guests** | `maxParty` arrives in both API forms; the stepper and the bar stop at it; the action re-checks under the lock. | T4: 9 guests → `party_too_large {max:'8', phone}`. T6: a DB-backed override → `+` disabled at 8, the hint with a `tel:` link, 8 options in the bar. T11: the same through the admin override. |
| **A6. Affected reservations are listed correctly** | `findAffected`: rules mode (`outside_hours`, `closed`, `over_capacity`) and closure mode. It never cancels anything. | T11: shortening dinner to 20:00 lists only the 21:00 booking; capacity 8 under 6+4 lists both; nothing changes status. T13: a dinner closure lists dinner, not lunch; a destination closure covers only that destination; a booking under two closures appears in both lists; cancelled, declined and already-started sittings never appear. E2E for each mode. |

## 2. Spec deviations that need a ruling

Each item gives a proposed ruling and what happens if the ruling turns out wrong.

**R1. Migration 006 ships together with the phase-4 code (spec §5.1.7 "mở rộng trước, thu gọn sau").**
- 006 only adds. But `reservations.meal` is NOT NULL and `source` has no default, so the phase-3 guest INSERT fails against a migrated database.
- **Proposed:** accept. The README says to apply 006 immediately before (or together with) the first phase-4 deploy, the same rule as 003 (`README.md:86-91`). The site has never been deployed (F2). Inside the plan, T1 bridges the old INSERT until T4 replaces it.
- **If wrong** (something gets deployed before phase 4): apply 006 in the deploy window, or temporarily give `source` the default `'web'` and let the trigger fill `meal`.

**R2. Booking rules and availability are never cached. Saves still call `updateTag('restaurants')` and `updateTag('booking-rules:<id>')`.**
- Spec §6.2 says "Không cache: đặt bàn, availability", and §10.1 asks for both tags. In phase 4 nothing reads under `booking-rules:<id>`; `restaurants` covers the catalogue (`bookingEnabled`, `meals`).
- The engine measured a working `'use cache'` reader in one process. It was rejected because of F11 (no persistence on serverless, per-instance revalidation) and because the action must re-read the rules under the lock anyway.
- **If wrong:** one extra query per availability request. Any future cached reader of rule data must tag `booking-rules:<id>`.

**R3. The lead time and the same-day cutoff.**
- **Lead:** a slot is bookable iff `minutesUntil > lead_minutes` on the minute-truncated venue clock (F3). Under truncation, "> lead" is exactly "còn ít nhất lead_minutes": at 18:30:59, `minutesUntil(19:00)` is 30 but only 29 min 01 s remain. It also equals phase 1. The research's and the admin prototype's `>=` (F13) would accept a booking with 29 min 01 s left.
- **Cutoff:** today closes once the venue clock is at or past `same_day_cutoff`. It reports the code `past`; the spec table has no code of its own. The cutoff is global only, as the spec lists no per-restaurant override. The copy of `error.past` must read correctly for both causes.
- **If wrong:** one minute either way at the boundary.

**R4. The API contract (the spec names two forms and a few fields).**
- **Range:** `GET /api/availability?restaurant=&lang=[&from=&to=]` → `{restaurant, today, now, maxParty, groupPhone: {display, tel} | null, days: [{date, state, reason?}]}`. `from` and `to` default to the window; the span is capped at 92 days.
- **Day:** `?restaurant=&date=&lang=[&guests=]` → `{restaurant, today, now, date, state, reason?, maxParty, leadMinutes, sameDayCutoff, periods: [{meal, closed, reason?, slots: [{time, left, bookable, block?}]}]}`. A closed period carries `slots: []`. `guests` defaults to 1.
- **States:** `open | full | past | closed | too_large | outside | unavailable`. **Blocks:** `closed | lead | cutoff | party | full`.
- **HTTP:**
  - 400 `{error}` with `restaurant_required`, `invalid_date`, `invalid_range` or `invalid_guests`;
  - 404 `restaurant_unavailable` for an unknown restaurant or one with booking off;
  - 200 with `state: 'outside'` for a valid date outside the window;
  - 503 `unavailable`;
  - always `cache-control: no-store`.
  - An invalid or disabled `lang` falls back to the default locale.
- `now` is an ISO instant; spec §10.2 already notes this phase-1 deviation.
- The client makes two requests (calendar, then day) and never sends `guests`. It closes sittings itself with the server's `leadMinutes`/`sameDayCutoff` and its clock offset (`clockBlock`).
- **If wrong:** one client to change, before phase 5.

**R5. Day states are computed for a party of one, and `full`/`past` days are greyed out like closed ones.**
- Phase 1 let a guest pick a full day and then said "No tables left". The reason shown is the public closure reason, else one of `booking.day_closed`, `booking.day_full` or `booking.day_past`.
- **If wrong:** a CSS and `reconcileBooking` change.

**R6. One slot time belongs to one service (spec silent).**
- Capacity is keyed by (restaurant, date, `reserved_at`), as in phase 1. The admin save rejects two active periods that share a slot time on a shared weekday ("Hai ca trùng giờ: Dinner và Drinks cùng có giờ 21:00."). `planDay` deduplicates by sort order as a second line of defence.
- This blocks Dinner (18:00–21:00) and Drinks (17:00–22:00) together in one restaurant; no restaurant has both today.
- **If wrong:** key capacity by (meal, time). That touches the load index, the loaders and the engine.

**R7. Migration 006 decides things §5.2 leaves open.**
- `search_text`, `version` and `updated_at` are kept by the trigger `reservations_before_write` (`fold_search()` + `reservation_search_text()`). App SQL never sets them.
- `reservations.meal` is NOT NULL. Legacy rows are backfilled from the seeded period that serves the time, then by time of day.
- `source` has no default. Legacy rows get `'legacy'`, `is_test = true`, and a `created` event with `actor_kind 'system'`.
- CHECK bounds:
  - `window_days` 1–90, `lead_minutes` 0–1440, `max_party` 1–50;
  - `covers_per_slot` 0–1000, `interval_min` ∈ {15, 20, 30, 45, 60, 90, 120}, last seating on the grid, no crossing midnight;
  - `status_reason` and event `reason` ≤ 500; notes ≤ 2000 and not blank;
  - closure `public_reason` non-empty and ≤ 160 (a `closure_i18n` row exists only when a reason was typed); `internal_note` ≤ 2000.
- `closures.show_reason` defaults to true.
- `reservation_events` integrity CHECKs: a staff actor needs `actor_id`; `created` needs `to_status`; `status_changed` needs two different statuses.
- `restaurants.updated_at`/`updated_by` are added now (they are also in phase 6's list; `IF NOT EXISTS`).
- Extra index `reservations_created_idx` for the "Tất cả" tab.
- **If wrong:** each item is a small follow-up migration.

**R8. Staff bookings and `over_capacity` (spec: a staff-created booking may exceed capacity with a reason).**
- **Proposed:** a staff **create or edit** may exceed capacity when it gives a reason. The reason goes on the `created`/`edited` event. No DB CHECK ties `over_capacity` to `source`.
- Staff paths use `planDay`. They ignore the online window, lead time, cutoff, `max_party` and `booking_enabled`, but never closures or non-slot times.
- A walk-in is only for the service day; a phone booking may not be in the past; an edit applies only to holding statuses.
- A private-event closure therefore also stops staff from recording a booking inside it; staff narrow the closure instead.
- **If wrong:** add a closure override with a reason later.

**R9. Lifecycle details the spec leaves open.**
- "Cùng ngày phục vụ" is the venue date with a 04:00 rollover (`serviceDay()`).
- Decline and cancel both require a reason (stored in `status_reason`).
- `seated` has no upper time bound.
- `no_show → seated` re-holds seats without a capacity check, because the guest is physically there.
- A note adds a `note_added` event with only `{note_id}`.

**R10. The phase-5 parts are left out.**
- No "Báo khách" or "Gửi email xác nhận" checkbox. The batch button reads "Hủy các đặt bàn đã chọn", not "Hủy và báo khách". It runs per booking and skips bookings that changed since the list was drawn.
- Every input carries `notifyGuest: false`; each transition declares `guestEmail`; `ReservationEffects` hooks run in the transaction.
- `submitReservation` steps 1 (BotID, honeypot), 5 (phone limit), the outbox part of 6, and `after(drainOutbox)` in 7 belong to phase 5 (§14.1 row 5).

**R11. Guest error codes and copy.**
- `closed` is added to `BOOKING_ERROR_CODES`, with `error.closed`.
- `error.party_too_large` = "For more than {max} guests, please call us on {phone}." with vars `['max', 'phone']`. The phone is the destination's number, else the first destination that has one (`restaurants.phone_*` arrives in phase 6).
- `submitReservation` takes `unknown` (zod) and also returns `data.status`.
- A lock timeout (55P03) is thrown, so the guest sees `error.network`; no new code.

**R12. Concurrency mechanics (not in the spec).**
- `SET LOCAL lock_timeout = '5s'`, then `pg_advisory_xact_lock(hashtextextended('booking:' || restaurant || ':' || date, 0))`. The pool has 5 connections, so a stuck holder must not queue a whole day forever.
- Rules saves do not take the booking-day lock. A save racing a booking can leave a slot over its new capacity; the affected list shows it as `over_capacity`.
- At most one booking-day lock per transaction: a date move locks only the target date, since freeing seats needs no lock.

**R13. `redirect()` inside the `try` (this changes the phase-3 convention "redirect() nằm ngoài try").**
- The guard requires `await requirePermission(…)` as the first statement, so `let id;` before the `try` is refused. `actionError` calls `unstable_rethrow` first, so `NEXT_REDIRECT` passes through.

**R14. What `booking_enabled = false` hides on the guest site (the spec names RESERVE and the form list).**
- It also drops: the Tàya hero's RESERVE A TABLE; the detail tab bar's RESERVE (the grid loses a column); the restaurant's Offers "VIEW OFFER"; a card's "Reserve a table" tag (a card without a detail page becomes non-actionable and `aria-disabled`); the search result's "Reserve" label.
- Generic RESERVE buttons stay and open the drawer on a bookable restaurant (`DEFAULT_RESTAURANT_ID` if bookable, else the first bookable one).

**R15. `audit_feed` shape and `/admin/audit` paging.**
- A reservation row reads: `source 'reservation'`, `action 'reservation.<type>'`, `entity_type 'reservation'`, `before {status}`, and `after` = `jsonb_strip_nulls({status, changes, reason})`, with `changes` nested.
- Paging is keyset (`?truoc=`/`?sau=`, 50 per page); `?trang=` links land on the newest page.
- From now on 006 owns the view. `migration-005.test.ts` stops at 005.

**R16. The scope of the admin screens.**
- `/admin/restaurants` is a minimal list linking to "Giờ và sức chứa"; phase 6 owns restaurant content.
- Inbox search ignores the active tab and searches every booking, newest first. "Hôm nay" uses the venue date.
- One concurrency token per restaurant (`restaurants.updated_at` in µs) guards both the rules form and the periods editor.
- Configuration writes go to `audit_log` with the entities in C7. Reservation writes, including batch cancels from a closure, go only to `reservation_events`.
- Nav: Đặt bàn (`reservations:read`), Nhà hàng (`schedule:read`), Cài đặt đặt bàn (`settings:read`, Admin).

## 3. Tasks in execution order (all on `main`, one commit per task, each ends green)

**Gate for every task:** typecheck → lint (exit 0, warnings ≤ 20) → `npm test` on `furama_cuisine_test` → reset `furama_cuisine_e2e_test` → build → `node scripts/check-prerender.mjs` → E2E (`--retries=0`) → visual at ratio 0 (8 passed). The exact commands are in §4.1. Never run `--update-snapshots`.

**Copy-from rule:** the code exists in `p4-engine.patch`, `p4g-guest.patch` and `p4-admin` commit `e274649` (never `5fd78c3`). Cherry-pick the pieces a task names, then reconcile them with §0 and §4. The plan drafts execute the tasks in order in an APFS clone and record the real RED output and test counts per task, as phase 3 did.

### PART A: data, engine, API and the guest form

**T1. Migration 006 and the phase-1 bridge**
- **Files:**
  - `db/migrations/006_booking_v2.sql` (C1, R7, §4.5);
  - `test/integration/migration-006.test.ts` on its own database, `furama_cuisine_migrate006_test`;
  - `test/integration/migration-005.test.ts`: `beforeAll(() => resetDatabase(url, '005_staff_auth_audit.sql'))`;
  - `test/integration/audit-feed.test.ts`: `TRUNCATE ${STAFF_TABLES}, reservations CASCADE` in `beforeEach` (the view now unions events);
  - `test/integration/availability.test.ts`: the raw fixture names `meal` and `source`;
  - `db/queries.ts createReservation` **bridge**: `source 'web'`, `meal` from a `service_periods` subselect (`$4::text` for the column, `$4::text::time` in the subselect), and a `created` event (`actor_kind 'guest'`). T4 deletes it;
  - `test/helpers/db.ts`: optional `TEST_DB_TAG` (the engine's helper).
- **Tests:**
  - constraints by name (§4.5); seed shape (25 rows; per restaurant, equal to `meals`); settings defaults and the single-row CHECK;
  - legacy rows: kept, `legacy`, `is_test`, meal, `search_text`, `version` 1, `updated_at = created_at`, one `system` event each;
  - the trigger bumps `version` once per UPDATE and nulls `search_text` when `anonymized_at` is set;
  - `fold_search(x) = fold(x)` for a fixed list that includes "Nguyễn Thị Ánh ĐỨC";
  - pg_trgm and the GIN index exist; `audit_feed` columns in 005's order; idempotent re-apply; a malformed `reserved_at` aborts and leaves nothing applied.
- **Gate:** E2E 70 and visual 8, unchanged.
- **Copy from:** engine §2 + admin §1 (trigger, `fold_search`, indexes) + admin `db/queries.ts`.

**T2. The pure engine**
- **Files:**
  - `lib/venue-time.ts`: `isoWeekday`, `fromMinutes`;
  - `lib/booking/rules.ts`: types, `RESERVATION_STATUSES`, `HOLDING_STATUSES`;
  - `lib/booking/resolve-day.ts`: `seatings`, `closureApplies`, `planDay`, `clockBlock`, `resolveDay`, `findSlot`, `resolveRange`;
  - `lib/booking/slot-code.ts`.
- **Tests:**
  - `resolve-day.test.ts` (the engine's 28, plus `clockBlock`);
  - `slot-code.test.ts`;
  - `venue-time.test.ts` additions;
  - `test/integration/booking-seed.test.ts`, with the phase-1 rule inlined.
- **RED:** the six mutations in §1, and the three seed mutations (Dinner last seating 20:30, covers +1, Lunch sort order).
- **Deps:** T1 (the seed test reads `service_periods`).

**T3. Rule loaders and the booking-day lock**
- **Files:**
  - `lib/server/booking/rules.ts`: `loadBookingRules(db, ids, locale, from)` → `Map<id, {rules, groupPhone}>` with a single-id wrapper; `loadBookedCovers(db, id, from, to)`. Dates leave SQL through `to_char`;
  - `lib/server/booking/lock.ts`: `lockBookingDay(client, restaurantId, date, {timeout = '5s'})`.
- **Tests (`test/integration/booking-rules.test.ts`):**
  - inherit versus override; the global cutoff; inactive periods left out;
  - closures by scope and by `ends_on >= from`; the reason by locale (reviewed; machine only with `serve_machine`; a disabled locale falls back to the default; `show_reason` off → null);
  - group phone: own destination, then the first destination with a phone (`mm` → resort);
  - holding statuses only in the covers;
  - `lock_timeout` 1 s → 55P03.
- **Deps:** T2.

**T4. `submitReservation` v2**
- **Files:**
  - `lib/server/booking/{input,create}.ts`;
  - `app/actions.ts`;
  - `lib/booking-errors.ts` (`closed`; `DEFAULT_PARAMS` gains `max`, `phone`);
  - `lib/i18n/registry.ts` (`error.closed`; `error.party_too_large` per R11).
  - Delete `lib/server/check-reservation.ts` (+ test), the T1 bridge, and `test/integration/reservations.test.ts` (its cases are ported).
- **Tests (`submit-reservation.test.ts`, `input.test.ts`):**
  - Da Nang date at 00:00–07:00; meal from the slot; `source 'web'`; locale fallback; `auto_confirm` global and per restaurant, with `confirmed_at`;
  - field codes; `max_party` 8 blocks 9 with `params {max:'8', phone}`; booking off; destination dinner closure and whole-day closure; lead and cutoff; holding versus non-holding statuses;
  - the 12-way race; the deterministic lock holder (second pool); two identical requests → one `duplicate`; reference retry (3); the `created` event.
- **RED:** remove `lockBookingDay` → 2 tests fail every run.
- **Gate:** the phase-1 client still renders the codes (`closed` and the new params). E2E 70.

**T5. Availability API v2 and the guest catalogue**
- **Files:**
  - `lib/booking/api.ts` (`CalendarResponse`, `DayResponse`, R4);
  - `app/api/availability/route.ts` v2. **Transitional:** the day form also returns `booked` and `capacity` (max `coversPerSlot`), so the phase-1 client keeps working; T6 removes them;
  - `db/queries.ts listRestaurants`: `bookingEnabled`, and `meals` from active periods in canonical order;
  - `lib/data.ts`: `Restaurant.bookingEnabled`;
  - `scripts/check-prerender.mjs`: fail when `/api/availability` appears in the prerender manifest;
  - delete `bookedCovers`/`slotCapacity`.
- **Tests:**
  - `availability.test.ts` v2: the engine's 18 plus the guest's (group phone fallback, 404 for off or unknown, `outside` → 200, every 400 code, `no-store`, `lang` fallback, a DB change visible on the next request);
  - `catalogue.test.ts`: `bookingEnabled`, and `meals` following active periods.
- **Gate:** E2E 70 with the old client (the engine's compat run passed 74/75 with its own extra specs).

**T6. The guest booking form v2**
- **Files:**
  - `lib/booking/client.ts` (+ test, on `api.ts`);
  - `components/site/SiteProvider.tsx`, `components/overlays/ReserveDrawer.tsx` (`DayStrip`), `components/booking/BookingBar.tsx`, `components/ui/Dropdown.tsx` (`hint`);
  - `styles/overlays.css` (new selectors only);
  - registry `booking.*` keys (screen `booking`), plus `ClientKey` and `CLIENT_KEYS`;
  - submit sends `locale`;
  - remove the T5 compat fields, and the phase-1 availability helpers and constants in `lib/booking.ts` and their tests (`SLOTS` stays in `lib/data.ts` until phase 10);
  - `e2e/availability-mock.ts`, with the `booking-dates.spec.ts` and `visual.spec.ts` mocks moved to v2.
- **E2E (`e2e/booking-v2.spec.ts`):**
  - mocked: a closed day greyed, unselectable and giving its reason; a meal closure; max party 8;
  - a real booking with a reference matching `^FC-[0-9A-HJKMNP-TV-Z]{8}$`;
  - **DB-backed** (through `db()`, restored afterwards): a whole-day closure greys the day on the next calendar fetch; a `max_party` override of 8 caps the stepper.
- **RED:** booking-v2 fails on the T5 build.
- **Gate:** visual 8 at ratio 0 with **no** baseline change; lint ≤ 20.

### PART B: lifecycle, admin screens, settings, audit, acceptance

**T7. Admin plumbing and the phase-3 deferred items**
- **Files:**
  - `lib/server/action-result.ts`: `unstable_rethrow` first; `params`; new codes (§4.7);
  - `lib/admin/auth-errors.ts`: messages with `{by}`, `{at}`, `{left}`;
  - `lib/server/client-ip.ts`, used by the DAL and accept-invite;
  - `lib/admin/form.ts` (`submitKeepingValues`);
  - `app/admin/(shell)/_ui/FormMessage.tsx` (always shows the general line; "Tải lại" on `conflict`/`not_allowed`);
  - `lib/admin/booking-schemas.ts` atoms (`blankToNull` including `undefined`, `Id`, `Version`, `Token`, `IsoDay`, `Time`, `Reason`);
  - `lib/server/audit-feed.ts` keyset with `entityLabels`;
  - `app/admin/(shell)/audit/page.tsx` (`?truoc=`/`?sau=`; reservation rows show the reference as text until T9);
  - `lib/admin/audit-labels.ts` (`reservation.*`, the new entities).
- **Tests:**
  - `action-result.test.ts` (redirect, notFound and forbidden rethrown, with `vi.stubEnv`);
  - `client-ip.test.ts`;
  - `booking-schemas.test.ts`;
  - `audit-feed.test.ts` (union; both directions; 65 rows tied on a µs; malformed cursor; labels);
  - `audit-labels.test.ts` (reads 006's type CHECK);
  - `e2e/admin-audit.spec.ts` (paging links).
- **RED:** without `unstable_rethrow`; with a ms cursor (2 tests fail).

**T8. Lifecycle domain (no UI)**
- **Files:**
  - `lib/reservations/lifecycle.ts`;
  - `lib/server/booking/reservations.ts` (`transitionReservation`, `createStaffReservation`, `editReservation`, `addReservationNote`, `staffActor`, `ReservationEffects`) on `loadBookingRules` + `planDay` + `loadBookedCovers` (+ `excludeId`) + `lockBookingDay`.
- **Tests:**
  - `lifecycle.test.ts` (the table, every window, `serviceDay` on a UTC clock);
  - `reservation-lifecycle.test.ts`: the admin's 19, plus:
    - cross-path locks (guest waits on staff, staff waits on guest);
    - staff booking on a date past the window and on a restaurant with booking off;
    - an edit of a web booking past capacity with a reason → `over_capacity` and the reason on `edited`;
    - a closed service → `closed`;
    - no `audit_log` row for any reservation write.
- **RED:** remove the lock from `createStaffReservation` → 7–8 of 8 parties get in.

**T9. Inbox and detail**
- **Files:**
  - `lib/server/booking/queries.ts` (`listInbox`, `getReservation`, `listEvents`, `listNotes`, `overviewCounts`) and `lib/reservations/search.ts`;
  - pages `reservations/page.tsx` and `reservations/[id]/page.tsx`, with `TransitionPanel`, `EditReservationForm`, `NoteForm`, `QuickConfirm`, `SectionNav`, `StatusBadge`;
  - actions `changeStatus`, `updateReservation`, `addNote`;
  - `styles/admin.css`;
  - the "Đặt bàn" nav entry, the overview counts, and reservation links on `/admin/audit`;
  - the guard's `BOOKING_ACTIONS` table, started.
- **Tests:**
  - `reservation-inbox.test.ts`; `search.test.ts`;
  - `e2e/admin-reservations.spec.ts`: confirm, cancel with a reason, windows, two-browser conflict, search, then confirm;
  - phase-3 nav expectations (`admin-acceptance`, `admin-users`) become `['Tổng quan', 'Đặt bàn']`.

**T10. New booking and day sheet**
- **Files:**
  - `reservations/new/{page,NewReservationForm}.tsx` (GET picker, slots from `planDay` + covers);
  - action `createReservation` (`redirect()` in the `try`);
  - `reservations/day/{page,PrintButton}.tsx`;
  - `daySheet`;
  - print CSS.
- **Tests:**
  - E2E: past capacity → refused, values kept, then saved with a reason → detail page;
  - E2E: the print view hides the chrome;
  - `daySheet` integration (bookings outside the current hours listed).

**T11. Giờ và sức chứa, the booking switch, and RESERVE visibility**
- **Files:**
  - `restaurants/page.tsx`;
  - `restaurants/[id]/booking/{page,RulesForm,PeriodsEditor,actions}.tsx` (`savePeriods` with `schedule:update`, `saveRules` with `reservations:configure`, then `updateTag(TAGS.restaurants)` and `updateTag(TAGS.bookingRules(id))`);
  - `lib/server/booking/config.ts` (periods, rules) and `affected.ts` (rules mode);
  - guest: `TayaHero`, `MobileBar`, `Offers`, `RestaurantCard`, `SearchOverlay`, `openRestaurant` (R14);
  - the "Nhà hàng" nav entry;
  - `playwright.config.ts` project `desktop-serial`.
- **Tests:**
  - `booking-config.test.ts` (periods and rules part):
    - seed parity; hours and capacity change; stale token → `conflict` naming the person;
    - the overlap rule; the grid refine;
    - affected (shorten → only 21:00; capacity 8 under 6+4 → both; nothing cancelled).
  - E2E A4 (Thai Siam dinner → preview, audit row, guest drawer shows 22:00 with "8 left"; restore).
  - E2E A5 through the admin override (`hura-izakaya`).
  - `desktop-serial`: Tàya's switch off → `/en` payload `taya-house=false`, no hero RESERVE, a 3-column tab bar, no search label, the drawer list without it; the switch on again. This also covers the phase-2 ledger's missing SearchOverlay label E2E.
  - Nav expectations add 'Nhà hàng'.
- **RED:** without `updateTag`, the switch spec fails (the engine's negative control).

**T12. Booking settings and per-restaurant auto-confirm (Admin)**
- **Files:**
  - `settings/booking/{page,SettingsForm,actions}.tsx` (`settings:read`/`settings:update`);
  - `restaurants/[id]/booking/{AutoConfirmForm,auto-confirm-actions}.tsx` (`reservations:auto-confirm`, rendered only when `roleCan`);
  - the "Cài đặt đặt bàn" nav entry (Admin);
  - the guard: `ADMIN_ONLY_ACTIONS` += both files, and the `BOOKING_ACTIONS` table completed.
- **Tests:**
  - integration: settings save and its token; `auto_confirm` per restaurant makes a guest booking `confirmed`;
  - E2E: Editor 403 and no auto-confirm control; the Admin saves; a replayed POST with the Editor's cookie → `forbidden` and 0 audit rows.
- **RED:** swap auto-confirm to `reservations:configure` → 2 guard failures.

**T13. Closures**
- **Files:**
  - `reservations/closures/{page,ClosureForm,actions}.tsx` (`schedule:update`);
  - `_ui/AffectedList.tsx`;
  - action `cancelReservations` (`reservations:update`);
  - `config.ts` closure CRUD with `closure_i18n` (`reviewed`/`human`) and `restaurantsInScope`;
  - `affected.ts` closure mode.
- **Tests:**
  - `booking-config.test.ts` (closures part): CRUD + audit; coverage per A6; batch cancel skips a changed version;
  - E2E: a Phố Cuốn dinner closure lists dinner and not lunch and cancels nothing; tick + reason + Hủy → "Đã hủy 1 đặt bàn." with one event;
  - E2E A2 through the admin: the guest's day goes grey with the public reason.

**T14. Acceptance, README, final gate**
- **Files:**
  - `e2e/booking-acceptance.spec.ts`: one test per A1–A6, reusing the fixtures. A1 replays the guest Next-Action POST in parallel for a slot with 4 covers left and checks `SUM(guests) ≤ capacity`;
  - `README.md`:
    - 006 ships with the phase-4 deploy (R1);
    - the Neon pre-flight queries (§6 risk 1);
    - the advisory-lock check on a Neon branch (a user step);
    - routes, screens and permissions;
    - the E2E data map and `desktop-serial`.
- **Final gate:** run it twice, plus one extra E2E run with `TZ=UTC` on the `next start` process, so server-side date code is checked in Vercel's zone.

## 4. Global constraints for the plan

### 4.1 Safety, environment, commands
- `.env.local` points at the **shared production Neon database**.
  - Never run `npm run db:migrate`, `npm run db:psql`, `npm run dev` or `vercel env pull`.
  - Never run `npx auth …` without `--config scripts/auth-cli.config.ts`.
  - Never connect to Neon.
- Every build, `next start`, E2E and visual command uses the local prefix:
  `CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test`
  - E2E adds `BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson E2E_PORT=3210`.
  - Visual uses port 3211.
- **Gate commands:**
  ```bash
  npm run typecheck
  npm run lint
  TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test
  RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
  CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
  node scripts/check-prerender.mjs
  CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson E2E_PORT=3210 npm run test:e2e -- --retries=0
  lsof -nP -iTCP:3211 -sTCP:LISTEN
  PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3211 EMAIL_DELIVERY=log npx next start -p 3211 &
  for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3211/ && break; sleep 1; done
  VISUAL_BASE_URL=http://localhost:3211 npm run test:visual
  lsof -ti tcp:3211 | xargs kill
  ```
- **Databases:**
  - The plan may create, reset or drop only `furama_cuisine_test`, `furama_cuisine_e2e_test` and the test-made `furama_cuisine_migrate{,004,005,006}_test`.
  - With `TEST_DB_TAG=x`, the helper databases become `…_x_test`.
  - Drafting agents use their own `<name>_test` databases and ports 3250–3269 (fix agents 3270–3279), and drop them when done.
- **zsh:** never start an argument with `=`; quote globs; pipe into `while read -r`, since zsh does not word-split.

### 4.2 Git
- Work on `main`, one commit per task, no push. `git add` named files only.
- Every commit message ends with the session's attribution line (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` for this one).
- The plan file and this research folder stay untracked, as in phase 3.

### 4.3 Next 16 and TypeScript 7 rules (carried over from phase 3, plus phase 4's)
- Read `node_modules/next/dist/docs` before any Next API, and cite `file.md:line`.
- `npm run typecheck` = `next typegen && tsc --noEmit --incremental false`. `next build` also typechecks the tests.
- Every admin `page.tsx` exports `instant = false` and calls `verifySession()`/`requirePagePermission()` before reading the DB. No inline `style=` under `app/admin`; no guest components; no `next/image`.
- **Actions:** the first statement is `await requirePermission(…)` (alone, as the only initializer, or first in a top-level `try` whose catch returns or throws). Then zod, then a transaction, then `updateTag`/`refresh()`, then an `ActionResult`. `redirect()` may sit in the `try` (R13).
- `updateTag` only in Server Actions (F11), after COMMIT. Reservation actions call `refresh()`.
- No `'use cache'` on anything that reads booking rules, covers or reservations (R2). The route handler reads `request.url` and sets `cache-control: no-store`; no `connection()`.
- E2E locators: role-based, or `getByLabel(…, { exact: true })`. Look up status text inside the dialog or `main`. A click on an `aria-disabled` day chip needs `{ force: true }`.
- Comments are in English and explain why.

### 4.4 Versions (no new packages)
`next@16.3.7`, `react@19.3.0`, `typescript@7.0.2`, `pg@8.23.0`, `zod@4.6.5`, `better-auth@1.7.7`, `libphonenumber-js@^1.13.14`, `vitest@5.0.3`, `@playwright/test@1.63.0`, `oxlint@1.86.0`, `oxc-parser@0.152.0`. Node 22.22.0 locally (24 in CI); Postgres 18.3 locally with pg_trgm 1.6.

### 4.5 Names (migration `006_booking_v2.sql`)
- **`booking_settings`** (one row):
  - `id boolean PK DEFAULT true`, CHECK `booking_settings_single_row`;
  - `window_days smallint 1–90 DEFAULT 14`, `lead_minutes 0–1440 DEFAULT 30`;
  - `same_day_cutoff time` (NULL = none; whole minutes);
  - `max_party 1–50 DEFAULT 12`, `auto_confirm false`, `guest_ack_email true`, `pii_retention_months 1–120 DEFAULT 24`;
  - `updated_at`, `updated_by`.
- **`restaurants`** adds:
  - `booking_enabled boolean NOT NULL DEFAULT true`;
  - overrides `window_days`, `lead_minutes`, `max_party`, `auto_confirm` (NULL = inherit);
  - `updated_at timestamptz NOT NULL DEFAULT now()`, `updated_by text`.
- **`service_periods`:**
  - columns: `id bigint identity`; `restaurant_id` FK (ON UPDATE/DELETE CASCADE); `meal`; `weekdays smallint[]` (ISO 1–7, default all); `first_seating time`, `last_seating time`; `interval_min` (default 30); `covers_per_slot`; `active`; `sort_order`; `created_at`, `updated_at`, `updated_by`;
  - CHECKs `service_periods_order`, `service_periods_grid`, `service_periods_weekdays_check`.
- **`closures`:**
  - columns: `id`; `scope`; `destination_id` FK destinations; `restaurant_id` FK; `starts_on`, `ends_on`; `meals text[]`; `show_reason DEFAULT true`; `internal_note`; `created_at/by`, `updated_at/by`;
  - CHECKs `closures_dates`, `closures_scope_target`, `closures_meals_check`.
- **`closure_i18n`:** PK `(closure_id, locale)`; `public_reason`; `status`, `origin`, `ai_model`, `source_hash`, `reviewed_by`, `reviewed_at`, `updated_at`, `updated_by`.
- **`reservations`** adds:
  - `meal NOT NULL`, `locale NOT NULL DEFAULT 'en'` FK, `source NOT NULL` (no default; `web|phone|walk_in|staff|legacy`);
  - `offer_id bigint`, `over_capacity`, `status_reason`, `confirmed_at`, `cancelled_at`, `search_text`, `is_test`, `anonymized_at`;
  - `version integer ≥ 1`, `updated_at NOT NULL`, `updated_by`.
  - CHECKs: `reservations_status_check` (6 statuses), `reservations_guests_check` (1–50), `reservations_reserved_at_check`, `reservations_meal_check`.
  - `reserved_at` stays text; compare it in SQL as `reserved_at::time`.
- **`reservation_events`:**
  - columns: `id`; `reservation_id` FK CASCADE; `at`; `actor_kind guest|staff|system`; `actor_id`; `actor_label`; `type`; `from_status`; `to_status`; `changes jsonb`; `reason`;
  - CHECKs `reservation_events_type_check`, `_staff_actor`, `_created_status`, `_transition`.
- **`reservation_notes`:** `id`, `reservation_id` FK CASCADE, `author_id`, `author_label`, `body`, `created_at`.
- **Functions:** `fold_search(text)` and `reservation_search_text(guest_name, email, phone, phone_e164, reference)` (IMMUTABLE); trigger function and trigger `reservations_before_write` (BEFORE INSERT OR UPDATE).
- **Indexes:**
  - `service_periods_restaurant_idx (restaurant_id, sort_order)`;
  - `closures_dates_idx (ends_on, starts_on)`;
  - `reservations_load_idx (restaurant_id, reserved_on, reserved_at) INCLUDE (guests) WHERE status IN ('requested','confirmed','seated')` (replaces `reservations_slot_idx`);
  - `reservations_inbox_idx (status, created_at DESC, id DESC)`;
  - `reservations_created_idx (created_at DESC, id DESC)`;
  - `reservations_pending_idx (reserved_on, reserved_at, id) WHERE status = 'requested'`;
  - `reservations_day_idx (reserved_on, restaurant_id, reserved_at)`;
  - `reservations_phone_idx (phone_e164, reserved_on)`;
  - `reservations_search_trgm_idx gin (search_text gin_trgm_ops)`;
  - `reservation_events_reservation_idx (reservation_id, at, id)`;
  - `reservation_events_at_idx (at DESC, id DESC)`;
  - `reservation_notes_reservation_idx`.
  - `reservations_dedupe_v2_idx` is unchanged.
- **`audit_feed`:** `source, id, at, actor_id, actor_label, action, entity_type, entity_id, locale, before, after`, in that order.
- **Audit entities (config):** `service_periods` (id = restaurant), `restaurant_booking`, `booking_settings` (action `settings`), `closure`.

### 4.6 Permissions

| Page or action (file under `app/admin/(shell)/`) | Permission | Editor |
|---|---|---|
| pages `reservations`, `reservations/[id]`, `reservations/day` | `reservations:read` | ✓ |
| page `reservations/new`; action `createReservation` | `reservations:create` | ✓ |
| actions `changeStatus`, `updateReservation`, `cancelReservations` | `reservations:update` | ✓ |
| action `addNote` | `reservations:note` | ✓ |
| pages `reservations/closures`, `restaurants`, `restaurants/[id]/booking` | `schedule:read` | ✓ |
| actions `addClosure`, `editClosure`, `removeClosure`, `savePeriods` | `schedule:update` | ✓ |
| action `saveRules` (booking switch and overrides) | `reservations:configure` | ✓ |
| `restaurants/[id]/booking/auto-confirm-actions.ts#saveAutoConfirmSetting` | `reservations:auto-confirm` | ✗ (Admin-only file) |
| page `settings/booking`; `settings/booking/actions.ts#saveSettings` | `settings:read` / `settings:update` | ✗ (Admin-only file) |

`submitReservation` stays on the public allowlist of 6. `reservations:purge-test` is unused in phase 4.

### 4.7 Error codes
- **Guest** (`BOOKING_ERROR_CODES`, registry `error.<code>`):
  - `restaurant_unavailable`, `party_too_large {max, phone}`, `outside_window`, `slot_unavailable {restaurant}`, `past` (lead or cutoff);
  - `invalid_name`, `invalid_phone`, `invalid_email`;
  - `full`, **`closed`**, `duplicate`, `unknown`, `network` (client only).
  - Phase 5 adds `consent_required`, `too_many_requests` and `bot_blocked`.
- **API errors:** `restaurant_required`, `invalid_date`, `invalid_range`, `invalid_guests` (400); `restaurant_unavailable` (404); `unavailable` (503).
- **Admin `ActionCode`:**
  - phase 3: `forbidden`, `invalid`, `db_error`, `already_staff`, `already_invited`, `not_found`, `last_admin`, `self`, `invalid_token`;
  - new: `conflict {by, at}`, `not_allowed`, `too_early`, `too_late`, `full {left}`, `closed`, `slot_unavailable`, `duplicate`.
  - `ActionFailure` gains `params?: Record<string, string>`.

### 4.8 Constants
- Defaults: window 14, lead 30, max party 12, cutoff NULL.
- Intervals: {15, 20, 30, 45, 60, 90, 120}. At most 20 periods per restaurant (zod).
- Seed sort orders: Breakfast 10, Lunch 20, Drinks 30, Dinner 40.
- `HOLDING_STATUSES = ['requested', 'confirmed', 'seated']`; `UPCOMING_STATUSES = ['requested', 'confirmed']`; `STAFF_SOURCES = { phone: 'confirmed', walk_in: 'seated' }`.
- Lifecycle windows: seated from 60 minutes before the sitting; no-show from 15 minutes after; corrections within the service day; `SERVICE_DAY_ROLLOVER_MINUTES = 240`.
- `MAX_RANGE_DAYS = 92`; `lock_timeout '5s'`; `REFERENCE_ATTEMPTS = 3`.
- Inbox: 30 per page. Audit: 50 per page.
- Length limits: reasons ≤ 500; notes ≤ 2000; closure public reason ≤ 160; internal note ≤ 2000.
- Reference regex `^FC-[0-9A-HJKMNP-TV-Z]{8}$` (legacy `FC-\d{5}` still found by search).

### 4.9 Code rules
1. **One lock:** every write that takes covers (guest submit, staff create, an edit that moves or grows a booking) calls `lockBookingDay` before reading rules or covers. Rules, covers and the INSERT/UPDATE happen in that same transaction. At most one booking-day lock per transaction.
2. Guest checks use `resolveDay`; staff, preview, day-sheet and affected paths use `planDay` (C2). `HOLDING_STATUSES` comes from `lib/booking/rules.ts` everywhere, including the SQL parameters.
3. **Dates:** a `date` column leaves SQL as `to_char(col, 'YYYY-MM-DD')`: never as a JS `Date` (node-pg parses it at local midnight), and not as `::text` (its format follows the session's DateStyle). A `time` column leaves as `to_char(col, 'HH24:MI')`. "Today" is `venueNow().date` passed as a parameter, or `(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`. Never `CURRENT_DATE`.
4. **The trigger owns** `version`, `updated_at` and `search_text` on `reservations`. App SQL sets `updated_by` only, and skips no-op UPDATEs, since every UPDATE bumps `version`. A later migration that UPDATEs reservations also bumps it.
5. Reservation writes go to `reservation_events` only; configuration writes go to `audit_log`, in the same transaction.
6. **`fold` (JS) ≡ `fold_search` (SQL):** search folds the query with `fold_search($1)`. The T1 test pins the two together.
7. New registry keys declare `screen` and `vars`, and their EN text keeps the vars.
8. `node-pg`: never run overlapping queries on one `PoolClient` (run them one after another inside transactions).
9. A config form re-syncs from its new token without remounting the component that holds the `useActionState` result: `key={token}` on the `<form>`, or adjust state during render.

### 4.10 E2E data map (proposal; the drafts finalise it)

| Spec | Restaurant | Dates or state | Cleanup |
|---|---|---|---|
| booking-v2 (T6), real booking | taya-house | first open day | none |
| booking-v2, DB closure | don-ciprianis | today + 9 | delete the closure |
| booking-v2, DB max party | the-fan | `max_party = 8` | reset to NULL |
| admin-reservations (T9) | taya-house | +3, +4, +6, yesterday | none |
| admin-reservations, search | v-senses-cafe | +8 | none |
| new booking (T10) | chaoshan-hotpot | +7 | none |
| hours (T11) | thai-siam-kitchen | periods; guest +2 | restore periods, delete the audit row |
| admin max party (T11) | hura-izakaya | override 8 | reset |
| switch (T11, `desktop-serial`) | taya-house | `booking_enabled` | switch back on |
| closures (T13) | pho-cuon | +5 | delete the closure |
| destination closure (T13) | mm (yum-food-village, chaoshan-hotpot) | +11 | delete the closure |
| acceptance (T14) | yum-food-village | +12 | none |

### 4.11 Baselines at HEAD
- Unit and integration: 41 files, 375 tests.
- E2E: 70 passed.
- Visual: 8 at ratio 0.
- Lint: exit 0 with 20 warnings.

Every task's final step states the new counts that its draft measured.

## 5. Review focus: five conditions most likely to bite

**1. Over capacity under concurrency**
- **What could go wrong:**
  - Two lock keys: the guest uses `booking:`, a staff path a different key, and the two never serialise.
  - Rules or covers read before the lock, then used for the decision.
  - Covers counted with `<> 'cancelled'` instead of `HOLDING_STATUSES`, so `no_show` and `declined` hold seats; or, the other way, `seated` is left out.
  - An edit that grows a party without locking.
  - A second lock in one transaction, risking deadlock.
  - Covers summed per meal while capacity is per time.
  - Over-capacity accepted without a reason.
  - A pool of 5 starved by lock waiters with no `lock_timeout`.
- **Pins:**
  - T4: the 12-way race and the deterministic second-pool holder.
  - T8: the 8-party staff race and the **cross-path** tests.
  - T14: the replayed-POST burst.
  - T3: `lock_timeout` → 55P03.
- **Reviewer checks:**
  - `grep -n pg_advisory` finds exactly one call site (`lock.ts`).
  - Every caller of `loadBookedCovers` on a write path runs after `lockBookingDay`, on the same client.

**2. Da Nang date boundaries and the cutoff**
- **What could go wrong:**
  - `CURRENT_DATE`, `new Date().getDate()`, or a node-pg `date` parsed at local midnight, any of which shift a booking by one day on Vercel's UTC.
  - The window computed on the device clock.
  - Lead `>=` instead of `>`.
  - The cutoff applied to tomorrow.
  - `serviceDay` without the 04:00 rollover.
  - The inbox "Hôm nay" or the overview using the server date.
  - E2E dates computed in the runner's zone.
- **Pins:**
  - T2: window across 16:59Z/17:00Z; lead 18:29 ok, 18:30 and 18:30:59 blocked; lead across midnight; cutoff 16:59 ok, 17:00 → past, tomorrow unaffected.
  - T4: 00:00–07:00 bookings stored on the Da Nang date.
  - T8: `serviceDay` at 17:30Z/21:00Z.
  - T3 and T9: every date leaves SQL as `YYYY-MM-DD` under `TZ=UTC`.
  - T14: the extra E2E run with `TZ=UTC`.
- **Reviewer checks:**
  - `grep -nE "CURRENT_DATE|(reserved_on|starts_on|ends_on)(::text)? AS"` over `lib/` and `app/` finds nothing: every date column leaves SQL through `to_char`.
  - E2E helpers use `venueNow`/`addDays`.

**3. Stale availability after rule edits**
- **What could go wrong:**
  - Someone adds `'use cache'` to the rules loader or the route.
  - The route loses `no-store`, or stops reading `request.url` and gets prerendered.
  - A period or switch save forgets `updateTag('restaurants')`, so the catalogue's `meals`/`bookingEnabled` stay old.
  - The client keeps a board for another restaurant or date (no `restaurant` echo check), or never reloads after a server refusal.
  - The admin preview keys its form by `updated_at` and loses the "Đã lưu" state.
- **Pins:**
  - T5: a DB change shows in the next API answer.
  - T11: A4 in the browser, and the switch spec's negative control (it fails without `updateTag`).
  - T6: `client.test` (a board for another date is ignored; reconcile after a refusal).
  - T5 extends `scripts/check-prerender.mjs`: `/api/availability` must not appear in the prerender manifest (**unverified** rule; today the script checks only guest pages and `/admin`).
- **Reviewer checks:**
  - No `'use cache'` under `lib/server/booking/` or `app/api/availability/`.
  - Every config action calls both `updateTag`s after COMMIT.

**4. Lifecycle races and time windows**
- **What could go wrong:**
  - A transition UPDATE without `version` or without `status = ANY(from)`, so the last writer wins.
  - The window checked only in the UI.
  - `from` not filtered by the window at write time.
  - A conflict message naming the wrong person.
  - `version` bumped twice (app plus trigger), or not at all (a path bypassing the trigger).
  - A correction allowed after the service day.
  - `seated → confirmed` colliding with the dedupe index and surfacing as `db_error` instead of `duplicate`.
  - Batch cancel applying a stale version.
  - The effects hook outside the transaction.
- **Pins:**
  - T8: racing transitions (one wins, one event); stale version → `conflict {by}`; every window boundary; the hook rollback; `duplicate` mapping.
  - T9: the E2E two-browser conflict.
  - T13: batch cancel skips a changed booking.
- **Reviewer checks:**
  - Every `UPDATE reservations` in app code carries `version = $n` in its WHERE.
  - No app SQL assigns `version` or `search_text`.

**5. Closures listing the wrong affected reservations**
- **What could go wrong:**
  - Destination scope matched on the wrong column (`restaurants.destination`).
  - The end date exclusive.
  - A meal closure listing every meal.
  - The list including cancelled, declined, no-show or already-started sittings, or leaving out `requested`.
  - A booking under two closures listed once.
  - An 'all' closure checked against one restaurant only.
  - An edited closure expiring only the new scope's tags.
  - The list computed before COMMIT.
  - Anything cancelled automatically.
- **Pins:**
  - T13 `booking-config.test.ts` closure cases (dinner vs lunch, destination, two closures, statuses).
  - T11 affected cases (outside_hours, over_capacity, nothing cancelled).
  - The T13 E2E.
  - T2's closure scope and inclusive-end mutations.
- **Reviewer checks:**
  - `findAffected` uses `closureApplies` from the engine (one implementation).
  - The closure actions tag `restaurantsInScope(old) ∪ restaurantsInScope(new)`.

## 6. Risks and day-1 checks

Each risk is labelled **Accepted** (a consequence of a ruling, or already mitigated) or **Needs a decision** (the user accepts it or opens later work).

1. **Needs a decision (before 006 reaches Neon).** pg_trgm on Neon PG18 is unverified: research rates it "likely" (F13), and agents may not touch Neon. If `CREATE EXTENSION` fails, the whole of 006 rolls back (F1). Read-only pre-flight:
   - `SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name = 'pg_trgm'`;
   - `SELECT count(*) FROM reservations WHERE reserved_at !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`;
   - `SELECT count(*), min(created_at), max(created_at) FROM reservations`;
   - `SELECT key, locale, value FROM content_strings WHERE key IN ('error.party_too_large', 'error.past')` (an old override would drop `{max}`/`{phone}`).
2. **Needs a decision.** `pg_advisory_xact_lock` and `SET LOCAL lock_timeout` through Neon's pooled (transaction-mode) URL are unverified. Spec §13 asks for one check on a Neon branch, which is a user step. The fallback (spec §16) is `SELECT … FOR UPDATE` on a lock row keyed by (restaurant, date).
3. **Needs a decision.** Phase-2 ruling 7 becomes reachable (F12): after `updateTag('restaurants')`, a guest request while the database is down gets a raw 500 instead of `error.tsx`. Low odds (an admin save needs the DB up a moment earlier). Revisit with the phase-10 hardening.
4. **Needs a decision (check on the first preview).** Whether `updateTag('restaurants')` reaches every Vercel instance's `'use cache'` catalogue (F11, "local by default"). A guest on another instance could see an old RESERVE/`meals` state. Availability itself is uncached, and the action re-checks.
5. **Accepted (R1).** 006 and the phase-4 code ship together.
6. **Accepted.** Pool of 5 with `lock_timeout 5s`: a burst on one restaurant-day queues; waiting transactions hold pool slots, so other requests on that instance wait too. A timeout reaches the guest as `error.network`.
7. **Accepted.** Two availability requests per page load and per restaurant switch (R4).
8. **Needs a decision (product).** A card without a detail page whose restaurant books offline becomes non-actionable. If every restaurant is switched off, the generic RESERVE opens an empty drawer. A "Gọi để đặt bàn" action could replace both.
9. **Needs a decision (venue).** The service day ends at 04:00 (R9). Staff cannot book inside a closed service (R8). Batch cancel is per booking, not all-or-nothing (R10).
10. **Accepted.** Legacy `is_test` rows still hold covers until they are purged; the purge UI (`reservations:purge-test`) is phase 10's "xóa dữ liệu test".
11. **Accepted.** `reservations.locale` FK is NO ACTION, so a locale with bookings can be disabled but not deleted (phase 8). `offer_id` is `bigint`, so phase 6's `offers.id` must match for the FK.
12. **Accepted.** Restaurants created later (phase 6) have no periods and read as closed every day; phase 6's create flow should seed default periods. Periods cannot cross midnight.
13. **Accepted.** Personal data: `search_text` and the `edited` events' `changes` hold names, phones and emails. Phase 10's anonymiser sets `anonymized_at` (the trigger then nulls `search_text`) and strips the personal keys from `changes`.
14. **Accepted.** The trigram index is used from about 200k rows (5.8 ms); below that the planner picks a seq scan (4 ms). There is no fuzzy matching. The `/admin/audit` keyset relies on the planner's Merge Append (0.05 ms at 200k), with no composite index.
15. **Accepted.** `guest_ack_email` and `pii_retention_months` can be edited but act only from phases 5 and 10. `auto_confirm` acts now.
16. **Needs a decision (monitor).** E2E load: about 20 new tests, plus phase-3 risk #15 (the `page-scope` flake) showing up in 2 of about 6 full runs under load. `desktop-serial` (C13) is unverified; if project dependencies misbehave, fall back to the guest spike's env-gated second build for the Tàya switch.
17. **Accepted.** `restaurants.slot_capacity`, `restaurants.meals` and `SLOTS` stay until phase 10. After T6, only the seed test reads them; the catalogue's `meals` now comes from periods.
18. **Accepted.** On-page times in the periods editor follow the browser's locale (an en-US Chrome shows AM/PM). Cosmetic.
19. **Accepted.** Hard-coded English in the booking UI ("Today", "Tomorrow", "Full", "N left", aria labels) moves to the registry in phase 7; phase 4 adds only new strings.
