# Spike 3 (p4-admin): reservations admin and status lifecycle, verified

> Spike report, key `reservations-admin` (clone `p4-admin`, branch `p4-admin-spike`). Topic: the reservations admin and the status lifecycle on top of the phase-3 admin shell.
> Where this report and `00-plan-outline.md` disagree, the outline wins (see its §0). In particular, the outline replaces this spike's `lib/reservations/resolve-day.ts`, the `loadDay`/`lockRestaurantDay` half of `lib/server/booking/rules.ts` and the guest `db/queries.ts` patch with the engine spike's `resolveDay`, `loadBookingRules` and `lockBookingDay`, and it merges this spike's migration into the engine's `006_booking_v2.sql`.

## Where the work is
- **Clone:** `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p4-admin`
  - Branch `p4-admin-spike`, on top of `3c04ace`.
  - Commit `e274649`: the spike (74 files, +6358/−107).
  - Commit `5fd78c3`: renames the migration-test databases for this agent only. Drop it when merging.
- **Full file contents** are in the patches:
  - `…/scratchpad/p4-admin-patches/0001-spike-phase-4-reservations-admin-and-status-lifecycl.patch` (352 KB)
  - `…/scratchpad/p4-admin-patches/0002-…patch`
  - In the clone: `git show e274649 -- <path>`.
- **Screenshots** in `…/scratchpad/p4admin-shots/`: overview, inbox-all, detail, new, day, day-print, closures, restaurants, booking, settings, audit.
- **Gate logs** in `…/scratchpad/`: `p4admin-gate.txt`, `p4admin-unit.txt`, `p4admin-build.txt`, `p4admin-e2e-1.txt`, `p4admin-e2e-2.txt`, `p4admin-lint.txt`.
- **The real repository was not touched.** `git status` there is clean.
- **Cleanup:** the databases `furama_cuisine_p4admin_{test,e2e_test,m003..m006_test}` were dropped, and nothing is listening on ports 3240–3249.

## Final gate (all on local Postgres 18.3, `CI=1 PG*= DATABASE_URL=postgres://localhost:5432/furama_cuisine_p4admin_e2e_test`)
| Step | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0; 20 warnings (the baseline), 0 errors |
| `TEST_DATABASE_URL=…/furama_cuisine_p4admin_test npm test` | **50 files, 452 tests passed**. Baseline was 41 files and 375 tests; 77 are new. |
| `npm run build` | exit 0 |
| `node scripts/check-prerender.mjs` | Passed. "Admin check passed: … /admin/reservations, /admin/reservations/closures, /admin/reservations/day, /admin/reservations/new, /admin/restaurants, /admin/settings/booking, … /admin/reservations/[id], /admin/restaurants/[id]/booking … have no static shell." |
| `npm run test:e2e -- --retries=0` (E2E_PORT=3240) | Run 1: **81 passed**. Run 2: 80 passed, 1 failed (see the note below the table). |
| `npm run test:visual` (next start on 3241) | **8 passed** at maxDiffPixelRatio 0, twice. |

The failure in E2E run 2 is `e2e/page-scope.spec.ts:71`, "a card opens the restaurant page under the curtain". This is phase-3 risk #15, a known flake. That spec then passed 20 of 20 times on its own with `--repeat-each=20`; machine load average was about 4.8 because sibling agents were running.

**Tests proved to fail without each fix** (each change was reverted, the test failed, then the change was restored):
- `actionError` without `unstable_rethrow`: the redirect/notFound/forbidden test fails.
- An audit cursor with millisecond precision: 2 tests fail, because rows sharing a millisecond are skipped or repeated.
- `createStaffReservation` without the advisory lock: in the race test, 7–8 of 8 parties are let in, against the 5 that fit.
- `blankToNull` without handling `undefined`: 2 schema tests fail.
- Swapping auto-confirm to `reservations:configure`: both guard tests fail.

---

## 1. Migration `db/migrations/006_reservations_v2.sql` (prototype; the engine spike owns the final version)
These are the parts the admin depends on, and they are verified by `test/integration/migration-006.test.ts` (legacy rows, constraints, trigger, failure on bad data, re-run):

- `CREATE EXTENSION IF NOT EXISTS pg_trgm` works inside the migrate transaction. Local Postgres has pg_trgm 1.6.
- **`booking_settings`:** one row (`id boolean PK DEFAULT true CHECK (id)`), with window_days 14, lead_minutes 30, same_day_cutoff `time` NULL, max_party 12, auto_confirm false, guest_ack_email true, pii_retention_months 24, updated_at, updated_by. Seeded `ON CONFLICT DO NOTHING`.
- **`restaurants` new columns:** booking_enabled NOT NULL DEFAULT true; window_days, lead_minutes, max_party and auto_confirm as nullable overrides; updated_at; updated_by.
- **`service_periods`:**
  - Columns: id, restaurant_id FK, meal CHECK, `weekdays smallint[]` CHECK ⊆ {1..7}, first_seating/last_seating `time`, interval_min ∈ {15,20,30,45,60,90,120}, covers_per_slot, active, sort_order, updated_*.
  - CHECK last ≥ first.
  - **Seed:** `restaurants × unnest(meals) JOIN (VALUES Breakfast 06:30–09:30/30, Lunch 11:30–13:30/30, Dinner 18:00–21:00/30, Drinks 17:00–22:00/60)`, covers = slot_capacity, guarded by NOT EXISTS. That gives 25 rows, equal to SLOTS × meals × slot_capacity, which a test checks.
- **`closures` → `closure_i18n`:**
  - `closures` has scope all/destination/restaurant, `destination_id` FK destinations, `restaurant_id` FK, starts_on/ends_on, `meals text[]` (NULL means the whole day), show_reason, internal_note, created_*, updated_*.
  - CHECKs tie the scope to its id.
  - `closure_i18n(closure_id, locale)` holds `public_reason` plus every translation-row column from §5.1.3.
- **`reservations`:**
  - A `DO $$` pre-check raises a readable error if any `reserved_at !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`. Then the CHECK is added, and `reserved_at` stays text.
  - The status CHECK widens to 6 statuses; guests 1–50.
  - New columns: meal (backfilled from the period that serves the time, else 'Dinner', then **NOT NULL**), `locale` FK locales DEFAULT 'en', source, offer_id (no FK), over_capacity, status_reason, confirmed_at, cancelled_at, search_text, is_test, anonymized_at, version, updated_at, updated_by.
  - **Source default trick:** `ADD COLUMN source … DEFAULT 'legacy'`, then `ALTER … SET DEFAULT 'web'`. Existing rows become legacy with no UPDATE.
- **`fold_search(text)`:** IMMUTABLE SQL `translate(lower(x), '<78 accented chars>', '<78 plain>')`.
  - The plain string was generated from the JS NFD fold, so the two agree. Example: "Nguyễn Thị Ánh ĐỨC" → "nguyen thi anh duc".
- **Trigger `reservations_before_write`** (BEFORE INSERT OR UPDATE):
  - `search_text := CASE WHEN anonymized_at IS NULL THEN concat_ws(' ', fold_search(guest_name), lower(email), substr(phone_e164,2), digits(phone)) END`.
  - On UPDATE it also sets `version := OLD.version + 1` and `updated_at := now()`.
  - So no write path can forget the version or the search text, and anonymising clears the search text.
- **Indexes:**
  - `reservations_load_idx (restaurant_id, reserved_on, reserved_at) INCLUDE (guests) WHERE status IN (requested, confirmed, seated)` replaces `reservations_slot_idx`.
  - `reservations_inbox_idx (status, created_at DESC, id DESC)`
  - `reservations_created_idx (created_at DESC, id DESC)`
  - `reservations_pending_idx (reserved_on, reserved_at, id) WHERE status='requested'`
  - `reservations_day_idx`
  - `reservations_phone_idx`
  - `reservations_search_trgm_idx gin (search_text gin_trgm_ops)`
- **`reservation_events`:**
  - Columns: reservation_id FK CASCADE, at, actor_kind guest/staff/system, actor_id, actor_label, type, from_status, to_status, `changes jsonb`, reason.
  - `type` CHECK allows created, status_changed, edited, note_added, **email_queued, email_sent, email_failed**. The last three are listed now so phase 5 needs no constraint change.
  - Indexes `(reservation_id, at, id)` and `(at DESC, id DESC)`.
  - Backfill: one `created` event per legacy row.
- **`reservation_notes`:** reservation_id, author_id, author_label, body (1–2000), created_at.
- **`audit_feed`:**
  - `CREATE OR REPLACE VIEW` with **exactly the 11 columns of migration 005, in order**, then `UNION ALL` over reservation_events.
  - The reservation branch maps to: source 'reservation', id `e.id::text`, action `'reservation.'||type`, entity_type 'reservation', entity_id `reservation_id::text`, before `{status: from}`, after `jsonb_strip_nulls({status, changes, reason})`.

## 2. The lifecycle map: `lib/reservations/lifecycle.ts` (client-safe; verified by `lifecycle.test.ts`)
```ts
export const TRANSITIONS: readonly Transition[] = [
  { from: 'requested', to: 'confirmed', window: ANY, reason: 'optional', guestEmail: { event: 'guest.confirmed', when: 'always' }, label: 'Xác nhận' },
  { from: 'requested', to: 'declined', window: ANY, reason: 'required', guestEmail: { event: 'guest.declined', when: 'always' }, label: 'Từ chối' },
  { from: 'requested', to: 'cancelled', window: ANY, ...CANCEL },   // reason required, guest.cancelled if_notify
  { from: 'confirmed', to: 'cancelled', window: ANY, ...CANCEL },
  { from: 'confirmed', to: 'seated', window: { kind: 'from_before', minutes: 60 }, reason: 'optional', guestEmail: null, label: 'Đã đến' },
  { from: 'confirmed', to: 'no_show', window: { kind: 'after', minutes: 15 }, reason: 'optional', guestEmail: null, label: 'Không đến' },
  { from: 'no_show', to: 'seated', window: CORRECTION, reason: 'optional', guestEmail: null, label: 'Sửa: khách đã đến' },
  { from: 'seated', to: 'confirmed', window: CORRECTION, reason: 'optional', guestEmail: null, label: 'Sửa: chưa đến' },
];
export const STAFF_SOURCES = { phone: 'confirmed', walk_in: 'seated' } as const;
export const SERVICE_DAY_ROLLOVER_MINUTES = 4 * 60;
export function serviceDay(now = new Date()): IsoDate { const v = venueNow(now); return v.minutes < SERVICE_DAY_ROLLOVER_MINUTES ? addDays(v.date, -1) : v.date; }
export function checkWindow(t, date, time, now = new Date()): { ok: true } | { ok: false; code: 'too_early' | 'too_late' } {
  const until = minutesUntil(date, time, now);
  switch (t.window.kind) {
    case 'any': return { ok: true };
    case 'from_before': return until <= t.window.minutes ? { ok: true } : { ok: false, code: 'too_early' };
    case 'after': return until <= -t.window.minutes ? { ok: true } : { ok: false, code: 'too_early' };
    case 'same_service_day': { const today = serviceDay(now); if (date === today) return { ok: true };
      return date > today ? { ok: false, code: 'too_early' } : { ok: false, code: 'too_late' }; }
  }
}
export function availableTransitions(status, date, time, now = new Date()) { return transitionsFrom(status).map((transition) => ({ transition, window: checkWindow(transition, date, time, now) })); }
```
- **Service day** is defined with lib/venue-time.ts: it runs until 04:00 Vietnam time the next morning. This was tested on a UTC clock: 17:30Z still falls in the service day of 2 Oct, and 21:00Z falls in 3 Oct.
- `availableTransitions()` exists because the React-purity lint rule forbids `new Date()` in a component body. The page calls it with no `now` argument.

## 3. Transitions: `lib/server/booking/reservations.ts` `transitionReservation`
```ts
return withTransaction(pool, async (client) => {
  const current = (await client.query(`SELECT status, version, reserved_on::text AS date, reserved_at AS time FROM reservations WHERE id = $1`, [input.id])).rows[0];
  if (!current) return { ok: false, code: 'not_found' };
  if (current.version !== input.version) return conflict(client, input.id);
  const transition = findTransition(current.status, input.to);
  if (!transition) return { ok: false, code: 'not_allowed' };
  const window = checkWindow(transition, current.date, current.time, now);
  if (!window.ok) return { ok: false, code: window.code };
  if (transition.reason === 'required' && !input.reason) return { ok: false, code: 'invalid', fieldErrors: { reason: ['Nhập lý do.'] } };
  const from = sourcesOf(input.to).filter((s) => checkWindow(findTransition(s, input.to)!, current.date, current.time, now).ok);
  const updated = await client.query(`UPDATE reservations SET status = $3,
        status_reason = CASE WHEN $3 IN ('cancelled','declined') THEN $4 ELSE status_reason END,
        confirmed_at = CASE WHEN $3 = 'confirmed' THEN coalesce(confirmed_at, now()) ELSE confirmed_at END,
        cancelled_at = CASE WHEN $3 = 'cancelled' THEN now() ELSE cancelled_at END, updated_by = $5
      WHERE id = $1 AND version = $2 AND status = ANY($6) RETURNING status, version`, [id, version, to, reason, actor.id, from]);
  if (updated.rowCount === 0) return conflict(client, input.id);
  const eventId = await insertEvent(client, actor, { reservationId: id, type: 'status_changed', from: current.status, to, reason });
  await options.effects?.afterTransition?.(client, { reservationId: id, transition, eventId, notifyGuest: input.notifyGuest });
  return { ok: true, data: updated.rows[0] };
});
// conflict(): SELECT actor_label, at FROM reservation_events WHERE reservation_id=$1 ORDER BY at DESC, id DESC LIMIT 1
//   → { ok:false, code:'conflict', params:{ by: actor_label ?? 'người khác', at: formatDateTimeVi(at) } }
```
- The actor is `staffActor(staff)` = `{ id: userId, label: "${name} (${email})" }`.
- A 23505 on `reservations_dedupe_v2_idx` maps to `duplicate`. This can happen when seated → confirmed puts the row back under the index.
- **Verified:**
  - When two transitions race, exactly one wins and the loser's `params.by` names the winner. Only one event row is written.
  - A stale version is a conflict that names the other person.
  - Windows: 17:59 is too_early and 18:00 is ok for a 19:00 sitting; no-show at 19:14 is too_early and at 19:15 is ok.
  - Correction at 00:30 the next day is ok; at 04:00 it is too_late.
  - The effects hook runs inside the transaction and sees the new status. A hook that throws rolls back both the row and the event.

## 4. The "notify guest" decision for phase 5
- Phase 4 shows **no** "Báo khách" or "Gửi email xác nhận" checkbox. No email can go out yet, and a checkbox that does nothing would mislead staff.
- The shape is already final:
  - Every write input carries `notifyGuest: boolean`; phase 4 actions pass `false`.
  - Each transition declares its email, as `guestEmail: { event, when: 'always' | 'if_notify' }`.
  - `ReservationEffects = { afterTransition?(client, { reservationId, transition, eventId, notifyGuest }), afterCreate?(client, { reservationId, status, eventId, notifyGuest }) }` runs in the same transaction, after the event row.
- Phase 5 therefore only needs to add the checkboxes, pass `effects` that INSERT into email_outbox, and call `after(drain)`. Nothing here changes shape.
- The `email_*` event types are already allowed by the CHECK.

## 5. Staff bookings, edits, notes
- **`createStaffReservation`:**
  - Walk-in is allowed only when `date === serviceDay(now)`; a phone booking may not be in the past.
  - Inside a transaction: `lockRestaurantDay` = `pg_advisory_xact_lock(hashtextextended('reservations:<id>:<date>', 0))`.
  - Then `loadDay` → resolveDay → `findOpenSlot`. A closed service gives `closed`; a time that is not a slot gives `slot_unavailable`.
  - If the booking would exceed the slot's covers, it returns `full` with `params.left`, unless an `overCapacityReason` is given. The reason is stored on the `created` event, and `over_capacity` is set to true.
  - Insert: status phone → confirmed, walk_in → seated; confirmed_at is set.
  - The reference is redrawn up to 3 times on `reservations_reference_key`.
  - **Concurrency verified:** 8 parallel parties of 3 against 16 covers gives exactly 5 ok and 3 `full`.
- **`editReservation`:**
  - A version check, then a diff into `changes` as `{field: [before, after]}`. An unchanged form records no event and does not bump the version.
  - Capacity is re-checked under the day lock only when the booking moves or the party grows. Its own covers are excluded (`heldCovers(…, excludeId)`), and `full` reports `left` without it.
  - Only holding statuses (requested, confirmed, seated) can be edited.
- **`addReservationNote`:** inserts into `reservation_notes`, plus an event `note_added` with `{note_id}` only. The note text is never copied into events, and the reservation's version is not bumped.
- **Guest path (`db/queries.ts`), minimal change so it survives migration 006** (the engine spike replaces it):
  - It takes the same advisory lock instead of `FOR UPDATE` on restaurants.
  - It counts holding statuses.
  - It sets `meal` from service_periods, using `$4::text` and `$4::text::time` (see errors).
  - It inserts a `created` event with actor_kind 'guest'.

## 6. Affected reservations: `lib/server/booking/affected.ts` (spec §10.1; never automatic)
- `findAffected(pool, { restaurantIds?, from?, to?, closureId?, now? })` loads upcoming bookings (requested, confirmed, sitting not started).
- It resolves each restaurant+date once through resolveDay, with held covers from a single grouped query.
- Each booking gets a kind:
  - `closed`, with the id of the closure that covers it;
  - `outside_hours`, from `misfit()`;
  - `over_capacity`, when the slot now holds more covers than its capacity.
- **Closure mode** matches the closure directly (scope, dates, then the meal of the slot's service), so a booking covered by two closures appears under both.
- **Verified:**
  - Shortening dinner to 20:00 lists only the 21:00 booking; nothing is cancelled.
  - Capacity 8 under 6+4 covers lists both bookings.
  - A dinner closure lists dinner but not lunch.
  - A destination closure covers that destination's restaurants and no others.
- **UI** (`app/admin/(shell)/reservations/_ui/AffectedList.tsx`):
  - Checkboxes carry `value="<id>:<version>"`, plus a reason and "Hủy các đặt bàn đã chọn".
  - The `cancelReservations` action runs one `transitionReservation` per ticked booking. A booking that changed since the page was drawn is skipped and counted as skipped.
  - The outcome notice is rendered outside the list, so it survives the list becoming empty after `refresh()`.

## 7. Configuration writes: `lib/server/booking/config.ts`
- **Concurrency token:** `US(col) = (extract(epoch FROM col) * 1000000)::bigint::text`. This is microseconds as text and exact; a JS Date keeps only milliseconds.
  - Restaurant rules and service periods share `restaurants.updated_at`, locked with `SELECT … FOR UPDATE`.
  - Settings and closures each have their own token.
- **A stale token is a `conflict`.** Its `by` is the `staff_user.name` of `updated_by`; `updated_by` stores the staff id (§5.1.6).
- **`saveServicePeriods`:** deletes the periods that are gone, then updates or inserts the rest with sort_order = index×10, bumps restaurants.updated_at, and writes audit `update/service_periods/<restaurantId>` with before and after arrays.
  - `overlappingPeriods()` refuses two active periods that share a slot time on a shared weekday. Message: "Hai ca trùng giờ: Dinner và Drinks cùng có giờ 21:00."
- **`saveRestaurantRules`** (reservations:configure) and **`saveAutoConfirm`** (reservations:auto-confirm) both write audit entity `restaurant_booking`.
- **`saveBookingSettings`** (settings:update) writes audit `settings/booking_settings`, without the token.
- **Closures** support create, update and delete, each with audit `create|update|delete / closure`. `closure_i18n` rows are written with `status='reviewed', origin='human'`.
- **Cache:** the actions call `updateTag(TAGS.restaurants)` + `updateTag(TAGS.bookingRules(id))` for periods and rules, and `bookingRules(id)` for auto-confirm.
  - Settings expire `restaurants` plus every restaurant's `booking-rules:<id>`.
  - Closures expire `bookingRules` for every restaurant in the old and new scope (`restaurantsInScope`), then call `refresh()`.
  - E2E verified that `updateTag` in an action re-renders the current admin page in the same response (`server-actions.md:145-150`): the slot preview shows "20:00 · 8/8" right after "Đã lưu ca phục vụ.".

## 8. Inbox: `lib/server/booking/queries.ts` `listInbox` and `lib/reservations/search.ts`
- **Tabs:**

  | Tab | Filter | Order |
  |---|---|---|
  | pending (Cần xử lý) | `status='requested'` | `(reserved_on, reserved_at, id)` |
  | today (Hôm nay) | `reserved_on = $today`, all statuses | `(reserved_on, reserved_at, id)` |
  | upcoming (Sắp tới) | `reserved_on > today`, requested or confirmed | `(reserved_on, reserved_at, id)` |
  | all (Tất cả) | none | `(created_at DESC, id DESC)` |

- **Keyset cursors:**
  - `YYYY-MM-DD_HH:MM_id` for the sitting tabs, with `(r.reserved_on, r.reserved_at, r.id) > ($d::date, $t, $id::bigint)`.
  - `<µs>_<id>` for "all", with `(r.created_at, r.id) < (timestamptz 'epoch' + $us::bigint * interval '1 microsecond', $id::bigint)`.
  - Pages hold 30 rows. Paging 65 rows that share sittings and a millisecond gave no repeats and no gaps in either order.
- **Search:**
  - Any search goes through **all** bookings, newest first.
  - `normalizeReference` requires the "FC" prefix and accepts any case, a missing dash, O→0 and I/L→1. It matches 8 Crockford characters or a legacy 5-digit reference. The lookup is exact on `reference`.
  - A query that is mostly phone characters with at least 8 digits and parses with `toE164` is an exact match on `phone_e164` (index scan).
  - Anything else is `search_text LIKE '%' || fold_search($1) || '%'`, with `escapeLike` applied first.
  - Digit-only fragments become digits, so "3456" finds …3456.
- **EXPLAIN:**

  | Query | Rows | Plan | Time |
  |---|---|---|---|
  | Phone search | 20k | Index Scan reservations_phone_idx | 0.018 ms |
  | Pending keyset | 20k | Index Only Scan reservations_pending_idx, row-comparison Index Cond | 0.035 ms |
  | "All" keyset | 20k | Index Only Scan reservations_created_idx | 0.018 ms |
  | Text search | 20k | seq scan, the planner's choice | 4 ms |
  | Text search | 200k | **Bitmap Index Scan reservations_search_trgm_idx**, literal and PREPARE alike (pattern folded to `'%khach 12345%'`) | 5.8 ms |

## 9. Audit feed and the phase-3 deferred items (all done)
- **`unstable_rethrow(err)` is the first line of `actionError`**, imported from `next/navigation` (`unstable_rethrow.md:62`). redirect(), notFound() and forbidden() now pass through.
  - The test needs `vi.stubEnv('__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS','1')` for forbidden().
  - This is what allows `createReservation` to call `redirect()` **inside** its try (see §10).
- **`clientIp(headers)`** in `lib/server/client-ip.ts` returns the first X-Forwarded-For entry, trimmed, and only if `isIP` passes with no zone id. Otherwise it returns null. It is used by `dal/session.ts` and `accept-invite/actions.ts`.
- **`/admin/audit` keyset:** `listAuditFeed(pool, { before?, after? })` uses a cursor `<µs>_<source>_<id>` and the key `(at, source, id::bigint)`.
  - `?truoc=` (older) and `?sau=` (newer, read ascending then reversed). The pager shows "← Mới hơn · Mới nhất · Cũ hơn →".
  - A malformed cursor gives the newest page.
  - The empty `<nav>` on a single page is gone, which also settles the phase-10 ledger item.
  - **EXPLAIN at 100k audit_log rows plus 100k events:** Merge Append over `audit_log_at_idx` and `reservation_events_at_idx` with an Incremental Sort, **0.05 ms** for both the newest page and a keyset page.
- **Entity labels:** `entityLabels(pool, rows)` looks up, in one UNION query, the `staff_user` email, the `staff_invitation` email (the deferred item) and the `reservation` reference. Reservation rows link to `/admin/reservations/<id>`.
- **audit-labels:** adds `reservation.<type>` actions and the entities reservation, service_periods, restaurant_booking, booking_settings and closure. A test reads the migration's CHECK list and the `entityType:` literals in config.ts, so a new event type or entity cannot go unlabelled.

## 10. Server Action pattern used everywhere, and the CI guard
```ts
export async function createReservation(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ reservations: ['create'] });
    const input = NewReservationForm.parse(Object.fromEntries(formData));
    …
    const result = await createStaffReservation(pool, staffActor(staff), { …, notifyGuest: false });
    if (!result.ok) return result;
    // redirect() throws NEXT_REDIRECT; actionError() rethrows it (unstable_rethrow), so it may sit in the try.
    redirect(`/admin/reservations/${result.data.id}`);
  } catch (err) {
    return actionError(err);
  }
}
```
- The guard refused the first draft, whose first statement was `let id: string;` before the try. This is the reason `unstable_rethrow` had to land before the first phase-4 action.
- `ActionFailure` gained `params?: Record<string,string>`.
- New `ActionCode`s: conflict, not_allowed, too_early, too_late, full, closed, slot_unavailable, duplicate.
- `actionErrorMessage(code, params)` renders:
  - "Vừa được {by} thay đổi lúc {at}. Hãy tải lại trang rồi làm lại." for a conflict;
  - "Khung giờ này chỉ còn {left} chỗ…" for full.
- **Guard (`test/guards/require-permission.guard.test.ts`):**
  - `ADMIN_ONLY_ACTIONS` adds `settings/booking/actions.ts` and `restaurants/[id]/booking/auto-confirm-actions.ts`. auto_confirm lives in a file of its own because the check is per file.
  - A new `BOOKING_ACTIONS` table asserts each action's **exact** permission literal and that `roleCan('editor')` matches what §7.1 says. It uses the new helper `actionPermissions(root, rel)` in `server-actions.ts`.

  | Action | Permission | Editor |
  |---|---|---|
  | changeStatus | reservations:update | ✓ |
  | updateReservation | reservations:update | ✓ |
  | cancelReservations | reservations:update | ✓ |
  | addNote | reservations:note | ✓ |
  | createReservation | reservations:create | ✓ |
  | addClosure / editClosure / removeClosure | schedule:update | ✓ |
  | savePeriods | schedule:update | ✓ |
  | saveRules | reservations:configure | ✓ |
  | saveAutoConfirmSetting | reservations:auto-confirm | ✗ (Admin only) |
  | saveSettings | settings:update | ✗ (Admin only) |

  - A swapped permission fails 2 tests (verified).
- **Pages:**

  | Page | Permission |
  |---|---|
  | inbox, detail, day | `requirePagePermission({ reservations: ['read'] })` |
  | new | `reservations:create` |
  | closures, restaurants, booking | `schedule:read` |
  | settings/booking | `settings:read` (Admin; an Editor gets the 403 view) |

  - The auto-confirm control renders only when `roleCan(staff.role, { reservations: ['auto-confirm'] })`.
  - Every page has `export const instant = false`. Unknown ids go to `notFound()`.

## 11. Client form patterns that worked
- **One transition form with several submit buttons** (`name="to" value=…`). React 19.3 builds `new FormData(form, submitter)` (react-dom-client.production.js:13645), so the clicked status reaches the action. The hidden `id` and `version` come from props; refresh() re-renders them.
- **`lib/admin/form.ts` `submitKeepingValues(dispatch)`.** `<form action>` resets uncontrolled fields after **any** result, so this helper does `preventDefault`, then `new FormData(form, submitter)`, then `startTransition(() => dispatch(fd))`.
  - `pending` and the returned state still come from `useActionState`, and a refused form keeps what was typed. E2E verified this: 30 guests refused as `full`, the fields kept, then accepted with a reason.
  - This answers the phase-7 "echo values on failure" item.
  - The add-closure form resets itself with `formRef.reset()` once `state.ok`.
- **After a save, re-sync from the new token without losing the action state:**
  - On `<form key={token}>` inside the component: the form remounts and the hook state stays.
  - Or "adjust state during render" (`if (token !== shownToken) { setShownToken(token); setRows(periods) }`) in `PeriodsEditor`. A `key` on the component would remount it and lose the "Đã lưu" notice.
- **`FormMessage` always shows the general line, `invalid` included.** A field error must never be silent, even for a field that is not on screen (see errors 14–15). It has a "Tải lại" button on conflict and not_allowed.
- **`blankToNull` treats `undefined` as blank too:** FormData has no entry for a field that was not rendered.
- **No inline styles.** Everything is in `styles/admin.css`: status badges, tabs, sub-nav, grid forms, chips, timeline, `.a-ref` nowrap, and checkboxes not inheriting the 44px text-input height.
- **`@media print`** hides `.a-sidebar`, `.a-header`, `.a-noprint` and `.a-subnav`, removes the padding, draws plain status text and sets `break-inside: avoid` per restaurant. E2E: `emulateMedia({ media: 'print' })` hides the sidebar and the "In bảng" button while the sheet row stays visible.
- **`PrintButton`** is a client component with `onClick={() => window.print()}`, because an inline `onclick` would break the CSP.
- **`watchCsp`** reported no violations on the detail and closures pages; the screenshot pass logged no console errors.

## 12. Screens built (Vietnamese, admin.css, useActionState, ActionResult)
- **`/admin` overview:** "N chờ xác nhận" and "N đặt bàn hôm nay · M khách", for roles with reservations:read.
- **Nav:** Đặt bàn, Nhà hàng, and Cài đặt đặt bàn (Admin).
- **`/admin/reservations`:**
  - The section's own links: Hộp thư · Tạo đặt bàn · Theo ngày · Ngày đóng cửa.
  - A search box and tabs; a "Trang sau →" keyset link and "← Trang đầu".
  - A "Test" tag and a "Vượt sức chứa" tag.
  - An inline "Xác nhận" on every requested row.
- **`/admin/reservations/[id]`:**
  - Facts, with a `tel:` link.
  - Transition buttons, disabled with a hint when outside their window ("Từ 19:15 ngày …", "Chỉ sửa được trong ngày phục vụ.").
  - A reason field.
  - The edit form (date, time select of all the restaurant's slot times, guests, name, phone, email, note, over-capacity reason).
  - Internal notes, and the timeline with field diffs and reasons.
- **`/admin/reservations/new`:**
  - A GET picker for restaurant and date. Slots come from resolveDay, labelled "19:00 · Dinner · còn 6/16" or "hết chỗ"; closed services are listed.
  - Source radio (walk-in disabled unless today), locale select from `locales` (default = the default locale), over-capacity reason.
- **`/admin/reservations/day`:** date and restaurant filter, previous and next day, print button, per-service tables with booked/capacity, guest note and staff notes, and a line for bookings that fall outside the current hours.
- **`/admin/reservations/closures`:** add form (scope / restaurant / destination, dates, meals with none meaning the whole day, EN and VI public reason, show reason, internal note), and per closure a card with edit (in `<details>`), delete (with a confirm) and its own affected list.
- **`/admin/restaurants`:** a minimal table linking to "Giờ và sức chứa".
- **`/admin/restaurants/[id]/booking`:** the rules form (booking_enabled, overrides with "N (mặc định)" placeholders), the auto-confirm select (Admin only), the periods editor (client state posted as one JSON field), the affected warning list, and the slot preview by date.
- **`/admin/settings/booking`** (Admin).

## 13. E2E added: `e2e/admin-reservations.spec.ts` (11 tests) and `e2e/reservation-fixtures.ts`
- An Editor confirms a request; the timeline names the actor; the version becomes 2.
- Cancel needs a reason; the reason is kept in status_reason and on the timeline.
- No-show and "Đã đến" are disabled before their window, with a hint. No-show works on yesterday's sitting. The correction button's state depends on the service day.
- Two browsers: the Admin confirms, then the Editor's decline shows "Vừa được Chủ quán E2E (owner@furama.test) thay đổi lúc …". The status is untouched, and "Tải lại" refreshes the page.
- **Closure acceptance:** a Phố Cuốn dinner closure lists the dinner booking but not lunch, and cancels nothing on its own. Tick, reason and Hủy then give "Đã hủy 1 đặt bàn.". There is one closure audit row and one cancelled event.
- The inbox finds a booking by a loosely typed reference and by a local-format phone, and confirms it from the results.
- A phone booking past capacity is refused with "chỉ còn …", the values are kept, the reason is added, and the browser is redirected to the detail page (redirect inside try). The DB row has source phone, confirmed, over_capacity, locale vi, 30 guests.
- The day sheet prints without the admin chrome.
- An Editor gets the 403 view on settings and sees no auto-confirm control.
- An Admin saves settings; the captured Next-Action POST, replayed with the Editor's cookie, answers `"code":"forbidden"` and writes no audit row.
- An Editor shortens Thai Siam dinner and sets capacity 8; the preview updates in the same response; one audit row is written; the test then restores the periods.
- **Phase-3 specs updated:** `admin-acceptance` and `admin-users` pinned the Editor nav to `['Tổng quan']`. They now expect `['Tổng quan', 'Đặt bàn', 'Nhà hàng']`.

## 14. Integration tests added
| File | Tests | Covers |
|---|---|---|
| `test/integration/reservation-lifecycle.test.ts` | 19 | transitions, conflicts, windows, the hook, staff bookings, the lock race, reference retry, edits, notes |
| `test/integration/booking-config.test.ts` | 10 | seed parity, hours and capacity change, conflicts, the overlap rule, affected lists, rules, auto-confirm, max_party 8, settings, closure CRUD and coverage |
| `test/integration/reservation-inbox.test.ts` | 6 | tabs, reference and phone and name and email search, keyset in both orders, day sheet, overview |
| `test/integration/migration-006.test.ts` | 4 | legacy rows, constraints, trigger, failure on bad data, re-run |
| `test/integration/audit-feed.test.ts` | 6 (rewritten) | union, both directions, µs ties, malformed cursor, labels |

Unit tests added: `lib/reservations/{lifecycle,resolve-day,search}.test.ts`, `lib/admin/booking-schemas.test.ts`, `lib/server/client-ip.test.ts`, plus additions to the action-result, format, nav and audit-labels tests.

## 15. Errors hit

1. **fold_search() mapped 'Đ' to 'y'. The translate() source had 78 characters and the target 79.**
   - Cause: I typed the plain-letter target string by hand and miscounted the 'o' run.
   - Fix: generated the target from the JS fold (NFD, strip U+0300–U+036F, đ→d) in node. Both strings are 78 characters, and 'Nguyễn Thị Ánh ĐỨC…' now folds to 'nguyen thi anh duc…'.
2. **pg DeprecationWarning: "Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0".**
   - Cause: loadDay() ran four queries in Promise.all on a single PoolClient inside the transaction.
   - Fix: made loadDay sequential, with a comment. Pool-level reads such as daySheet and findAffected still run in parallel.
3. **error: inconsistent types deduced for parameter $4 (guest createReservation after migration 006).**
   - Cause: the same parameter was used as text (reserved_at) and as `$4::time` in the meal subselect.
   - Fix: use `$4::text` for the column and `$4::text::time` in the subselect.
4. **null value in column "meal" violates not-null constraint (test/integration/availability.test.ts fixture).**
   - Cause: migration 006 makes reservations.meal NOT NULL, and a raw-SQL fixture inserted no meal.
   - Fix: the fixture now inserts meal 'Dinner'. App inserts set meal explicitly: staff writes take it from resolveDay, the guest path from service_periods.
5. **migration-005.test.ts 'is safe to apply again' and 'audit_feed columns' failed once 006 existed.**
   - Cause: an early draft of 006 appended a `seq` column to audit_feed. CREATE OR REPLACE VIEW in 005 cannot drop columns, so re-running 005 on top of 006 failed. Even without the extra column, re-running 005 would silently drop the reservation branch.
   - Fix: removed seq; keyset paging now uses (at, source, id::bigint), and EXPLAIN shows a Merge Append over both at-indexes. The 005 test now migrates only up to 005 (`resetDatabase(url, '005_staff_auth_audit.sql')`). Migration 006 now owns the view, and a comment says so.
6. **actionError test: forbidden() threw '`forbidden()` is experimental and only allowed … authInterrupts' instead of the HTTP fallback error.**
   - Cause: Next reads experimental.authInterrupts from process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS, which Vitest does not set.
   - Fix: `vi.stubEnv('__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS', '1')` in the test, plus `vi.unstubAllEnvs()` in afterEach.
7. **Format test expected 'T2, 05/10/2026' but got 'Th 2, 05/10/2026'.**
   - Cause: ICU vi-VN with weekday 'short' gives 'Th 2' and 'CN'.
   - Fix: updated the expectation and the doc comment.
8. **CI guard: 'app/admin/(shell)/reservations/actions.ts#createReservation: does not start with await requirePermission()'.**
   - Cause: the first draft declared `let id` before the try and called redirect() after it, as the phase-3 convention 'redirect outside try' suggested.
   - Fix: redirect() now sits inside the try, after the success path. actionError() rethrows NEXT_REDIRECT through unstable_rethrow, and an E2E test covers it. This is the concrete reason the ledger asked for unstable_rethrow before the first phase-4 action.
9. **oxlint errors: jsx-a11y(control-has-associated-label) on `<th scope="col" />`; react(purity) 'Cannot call impure function during render' (new Date()); no-unused-vars.**
   - Cause: an empty actions header cell; computing now in the detail page body; an unused locales fetch.
   - Fix: the header cell says 'Thao tác'. Added `availableTransitions(status, date, time, now = new Date())` in lifecycle.ts, so the page passes no Date. Removed the unused fetch. Lint is back to exit 0 with 20 warnings.
10. **TypeScript errors in the tests: readonly [1,2,3] is not assignable to number[] (`as const` base), and an invalid conversion of TransitionResult to { params }.**
    - Cause: `as const` made weekdays readonly; a discriminated union was cast directly.
    - Fix: typed the base as `Omit<PeriodInput, …>`; used `as unknown as` for the conflict casts. next build typechecks tests, so this matters.
11. **E2E: 'Thêm ngày đóng cửa' did nothing visible. The POST succeeded with status 200, but no row was created and no message appeared.**
    - Cause: for scope 'restaurant' the destination select is not rendered, so FormData has no destinationId. zod got undefined, the preprocess only mapped '' to null, and nullable() rejected undefined. The resulting fieldErrors.destinationId had no field on screen, and FormMessage hid general messages whenever fieldErrors existed.
    - Fix: blankToNull now treats undefined as blank. FormMessage always shows the general line for a failure ('Dữ liệu chưa hợp lệ…'), so no field error can be silent. booking-schemas.test.ts pins both cases and fails without the fix.
12. **E2E: the inbox 'Xác nhận' button answered 'Dữ liệu chưa hợp lệ'.**
    - Cause: the same undefined-field bug: QuickConfirm sends no reason field.
    - Fix: the same blankToNull fix. The inbox now shows 'Xác nhận' on every requested row, search results included, and the test no longer depends on pagination.
13. **E2E: the day-sheet row lacked '19:00'.**
    - Cause: the sheet printed the time only on a slot's first row, and an earlier run had left another 19:00 booking on that date.
    - Fix: the sheet prints the time on every row, which also reads better on paper; the slot load stays on the first row only.
14. **E2E (fresh database only): the 'Đã hủy 1 đặt bàn.' notice never appeared after a batch cancel.**
    - Cause: cancelReservations calls refresh(), the affected list becomes empty, and AffectedList returned early without its form, so the notice disappeared. Isolated runs passed only because leftover rows kept the list non-empty.
    - Fix: the outcome notice is rendered outside the list conditional (an empty-list branch with role=group). The test asserts against the card, not the form.
15. **E2E strict-mode violation: getByLabel('Giờ') matched both the time select and 'Lý do vượt sức chứa (chỉ khi khung giờ đã hết chỗ)'.**
    - Cause: substring label matching.
    - Fix: every getByLabel in the new spec uses `{ exact: true }`, as the phase-3 locator rule says.
16. **Phase-3 E2E specs admin-acceptance:105 and admin-users:158 expected the Editor nav to be exactly ['Tổng quan'].**
    - Cause: phase 4 adds 'Đặt bàn' and 'Nhà hàng' for Editors (spec §7.1).
    - Fix: updated both expectations to ['Tổng quan', 'Đặt bàn', 'Nhà hàng'], with a comment.
17. **e2e/page-scope.spec.ts:71 'a card opens the restaurant page under the curtain' failed in 2 of about 6 full E2E runs (curtain log [] instead of ['true','false']).**
    - Cause: known phase-3 risk #15, a load-related flake in a guest spec this spike does not touch. The machine load average was about 4.8 because of sibling agents, and the 11 new admin tests add parallel load.
    - Fix: no code change. It passed 20 of 20 with --repeat-each=20 in isolation, and the final full run 1 passed 81 of 81. CI has retries: 1. Keep monitoring.
18. **Visual review: closure meal checkboxes and source radios each took a 44px-tall row.**
    - Cause: `.a-field input { min-height: 44px }` also applied to checkbox and radio inputs.
    - Fix: CSS `.a-field input[type=checkbox|radio], .a-check input { min-height: 0; margin: 0; padding: 0 }`; fieldset.a-field is now a flex wrap. References get `.a-ref { white-space: nowrap }`, and an empty notes list renders nothing.
19. **Process slip: during one RED check a backup copy was written to /tmp/af.bak.**
    - Cause: a shell fallback chain `cp … /tmp/af.bak || …`.
    - Fix: deleted right away. Every other temporary file is under the scratchpad.

## 16. Package versions

- No packages installed or changed (package.json untouched).
- next@16.3.7
- react@19.3.0
- react-dom@19.3.0
- typescript@7.0.2
- pg@8.23.0
- zod@4.6.5
- better-auth@1.7.7
- libphonenumber-js@^1.13.14 (as installed)
- vitest@5.0.3
- @playwright/test@1.63.0
- oxlint@1.86.0
- oxc-parser@0.152.0
- Postgres 18.3 (Homebrew), extension pg_trgm 1.6 (btree_gist 1.8 available, unused)
- Node v22.22.0

## 17. Recommended task breakdown (spike author)

The admin half of the phase-4 plan, in dependency order. Each task closes with the full phase-3 gate (typecheck, lint, unit + integration, reset, build, check-prerender, E2E, visual).

1. **Migration 006, merged with the engine spike.**
   - Take the engine spike's resolveDay and guest columns, and keep from this spike:
     - meal NOT NULL with its backfill;
     - fold_search() and the reservations_before_write trigger (search_text, version, updated_at);
     - the source 'legacy' → 'web' default trick;
     - closures.destination_id → destinations, and closure_i18n;
     - reservation_events with the email_* types already in its CHECK;
     - reservation_notes;
     - the indexes;
     - audit_feed with the same 11 columns plus a UNION over reservation_events.
   - Tests: migration-006.test.ts, plus migration-005.test.ts scoped to `--until 005`.
   - Also fix the availability fixture (meal) and the guest createReservation (advisory lock, holding statuses, created event), or let the engine task replace that path.
2. **Shared admin plumbing.**
   - actionError with unstable_rethrow, `params`, and the new ActionCodes and messages.
   - clientIp().
   - lib/admin/form.ts submitKeepingValues.
   - FormMessage that always shows the general line.
   - booking-schemas with blankToNull handling undefined, and its tests.
3. **Lifecycle domain.**
   - lib/reservations/lifecycle.ts (map, windows, serviceDay, availableTransitions).
   - lib/server/booking/reservations.ts (transition, createStaffReservation, editReservation, addReservationNote, the ReservationEffects hook).
   - lib/server/booking/rules.ts (loadDay, lockRestaurantDay, the µs US() token).
   - Integration tests: reservation-lifecycle.test.ts, including the 8-party race and the two-person conflict. Depends on 1 and on resolveDay.
4. **Reads.** lib/server/booking/queries.ts (inbox keyset and search, detail, events, notes, day sheet, overview) with lib/reservations/search.ts; reservation-inbox.test.ts.
5. **Audit feed rewrite.** Keyset `?truoc=`/`?sau=`, entityLabels (invitation email, reservation reference), new audit labels; tests.
6. **Screens: inbox and detail** (TransitionPanel, EditReservationForm, NoteForm, QuickConfirm, SectionNav, StatusBadge), plus the overview counts and the nav. Update the two phase-3 E2E nav expectations.
7. **Screens: new and day sheet** (two-step GET picker, over-capacity reason, redirect inside try, print CSS, PrintButton).
8. **Closures.**
   - config.ts closure CRUD with audit and closure_i18n.
   - affected.ts.
   - The closures page with the per-closure affected list, and cancelReservations.
   - booking-config.test.ts, closures part.
9. **Hours and capacity, and booking settings.**
   - saveServicePeriods with the overlap rule; saveRestaurantRules.
   - The Admin-only auto-confirm-actions.ts and settings/booking/actions.ts.
   - Pages and forms (PeriodsEditor's token re-sync) with updateTag('restaurants') and updateTag('booking-rules:<id>').
   - Guard: ADMIN_ONLY_ACTIONS plus the BOOKING_ACTIONS permission matrix.
10. **E2E and acceptance.** e2e/admin-reservations.spec.ts (11 tests) and reservation-fixtures.ts. Then a joint run with the guest spike for the cross-cutting checks: the Editor changes dinner and the guest sees the new slots; max_party 8 blocks 9 guests in the guest form; closed days are greyed for guests.

Estimate for tasks 2–10, based on this spike: about 4–5 dev-days. The code exists and is verified; most of the remaining work is reconciling migration 006 and resolveDay with the engine spike.

## 18. Risks and open questions

- Migration 006 here is a prototype; the engine spike owns the final version. The lead has to reconcile the two: column names, meal NOT NULL, the trigger-maintained search_text and version, fold_search, window_days bounded to 1–60, guests to 1–50, interval_min to {15,20,30,45,60,90,120}, and closure_i18n's columns. The admin code depends on: restaurants.updated_at as the concurrency token; reservations.version bumped by the trigger; reservations.meal; reservation_events.type including status_changed, edited, note_added; and audit_feed keeping 005's 11 columns.
- resolveDay in lib/reservations/resolve-day.ts is the admin's prototype. Its inputs (PeriodRule, ClosureRule, BookingRules, booked) and outputs (services[].closedBy, slots[] with capacity/booked/left/bookable/reason, findOpenSlot, misfit) must match the engine's version, or the affected lists and staff bookings drift. One small difference: the lead time here is bookable when minutesUntil ≥ lead, while today's guest isSittingClosed uses <= LEAD (one minute stricter).
- The guest path still checks capacity against restaurants.slot_capacity and SLOTS, not service_periods. The engine spike must move it to resolveDay, or a change in /admin/restaurants/[id]/booking will not affect guest capacity. Guest and staff writes already share pg_advisory_xact_lock('reservations:<id>:<date>'). The advisory lock through Neon's pooled URL is still unverified (spec §16).
- Overlap rule (my decision; the spec is silent): within one restaurant, a slot time may belong to only one active service on a shared weekday. That blocks Dinner (18:00–21:00) and Drinks (17:00–22:00) together in one restaurant; no restaurant has both today. If they are needed, capacity must be keyed by (meal, time), which changes the load index, heldCovers and resolveDay.
- Staff bookings ignore the online window, the lead time and max_party, but never closures or non-slot times. A private-event closure therefore stops staff from recording the event's own booking. Open question: allow a staff override of a closure with a reason?
- A service day runs until 04:00 Vietnam time the next morning (my definition of 'cùng ngày phục vụ'); confirm with the venue. Seated has no upper time bound. no_show → seated re-holds seats without a capacity check, because the guest is physically there.
- The decline/cancel reason is stored in status_reason, and phase 5 will put it in the guest email. The UI label does not yet say the guest will read it. Phase 5 should add that wording together with the 'Báo khách' checkbox.
- Batch cancel runs one transaction per booking and skips any that changed since the list was drawn, rather than all-or-nothing. That is deliberate (it reports 'N đã hủy; M vừa thay đổi'), but confirm it is the UX wanted.
- The page-scope E2E flake (phase-3 risk #15) showed up in 2 of about 6 full runs under load (load average ~4.8 from sibling agents). It passes 20/20 in isolation, and CI has retries: 1. The 11 new admin tests add parallel load; consider workers or retries if it shows up in CI.
- E2E specs write to shared restaurants on dates no other spec books: pho-cuon at +5 days, v-senses-cafe at +8, thai-siam-kitchen's periods (restored after the test), taya-house at +3/+4/+6. A guest-side E2E that books those restaurants on those dates could collide; the closure test deletes its closure afterwards.
- /admin/audit keyset sorts on id::bigint over a UNION view. It is fast now (Merge Append plus Incremental Sort, 0.05 ms at 200k rows), but it depends on the planner keeping that plan; there is no composite index on (at, source, id).
- The trigram search uses its index at 200k rows (5.8 ms) and the planner picks a seq scan at 20k (4 ms). Fine at this scale; there is no fuzzy matching for typos (ILIKE substring only).
- Auto-confirm, guest_ack_email and pii_retention_months are editable now but have no effect until the engine (auto_confirm on submit), phase 5 (ack email) and phase 10 (anonymiser) use them.
- On-page times in the periods editor follow the browser's locale (an en-US Chrome shows 06:00 PM); Vietnamese Chrome shows 24-hour times. Cosmetic.
- updateTag inside the admin actions is verified to re-render the current admin page. It has not been verified that a cached guest reader tagged booking-rules:<id> exists; that is the engine/guest spikes' job.

## 19. Spec deviations (spike author)

- §10.3 'Báo khách' (cancel) and 'Gửi email xác nhận' (staff booking) checkboxes are omitted in phase 4, because no email can be sent yet. The data shape is ready: notifyGuest is in every input, guestEmail sits on every transition, and ReservationEffects hooks run inside the transaction. Phase 5 adds the checkboxes and the outbox effects.
- §5.2 search_text, version and updated_at are maintained by a BEFORE INSERT/UPDATE trigger on reservations, not by application code. search_text = fold_search(name) + lower(email) + phone digits, folded by an IMMUTABLE SQL function that also folds the search query. An anonymised row (anonymized_at set) automatically gets search_text NULL.
- §5.2 reservations.meal is NOT NULL, backfilled from the seeded period that serves each legacy time (else Dinner). The spec does not state nullability.
- §5.2 reservation_events.type CHECK already lists phase 5's email_queued, email_sent and email_failed. Notes create a 'note_added' event with only {note_id}; the text stays in reservation_notes.
- §10.3 'cùng ngày phục vụ' is defined as the venue date with a 04:00 rollover (serviceDay()).
- §10.3 decline and cancel both require a reason. The spec only says decline goes 'kèm lý do'.
- §10.1 'affected reservations' also lists bookings in slots now over capacity (kind over_capacity), besides closures and changed hours. The batch 'Hủy' is per-booking and skips any whose version changed.
- §7.2 inbox search ignores the active tab and searches every booking, newest first.
- /admin/audit paging changed from ?trang=N (OFFSET) to keyset ?truoc=/?sau= cursors, with 'Mới hơn / Mới nhất / Cũ hơn' links. Old ?trang links fall back to the newest page. The empty pager nav (a phase-10 ledger item) is gone.
- Phase-3 convention 'redirect() nằm ngoài try': createReservation calls redirect() inside its try, which is safe because actionError() now calls unstable_rethrow first. The CI guard requires requirePermission as the first statement, so a declaration before the try is not allowed.
- Staff bookings (§10.3 may exceed capacity with a reason) also bypass the online window, lead time and max_party, but not closures or non-slot times. A walk-in is today only; a phone booking may not be in the past.
- Spec-silent rule added: within a restaurant, one slot time belongs to at most one active service on any weekday.
- auto_confirm per restaurant is a separate Admin-only action file (reservations:auto-confirm), so the CI guard can enforce Admin-only per file. booking_enabled and the other overrides (reservations:configure) and the periods (schedule:update) are open to Editors, per the §7.1 matrix.
- One concurrency token per restaurant (restaurants.updated_at) guards both the rules form and the periods editor. Saving one advances the other's token, and the action's re-render passes the new token to both forms.
- Closures are written to audit_log (create/update/delete, entity 'closure') as configuration. Reservation changes, including batch cancels triggered from a closure, go only to reservation_events (§7.4).
- The guest db/queries.ts createReservation was changed minimally so it keeps working after migration 006: an advisory lock instead of FOR UPDATE on restaurants, holding statuses for the covers, meal from service_periods, and a guest 'created' event. Its capacity still comes from slot_capacity. The engine spike owns the real change.
