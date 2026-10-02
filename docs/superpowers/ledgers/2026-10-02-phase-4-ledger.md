# Phase 4 ledger — reservations v2

Plan: `docs/superpowers/plans/2026-10-02-phase-4-reservations-v2.md`. Spec: `docs/superpowers/specs/2026-10-01-admin-cms-design.md`.

Executed on `main` from b914c4c to 75106f7: 14 task commits (cherry-picked from the verified clone, each with a task review), 4 review-fix commits during the tasks (4178160 fold_search NFD, b659cec guest availability failures, bcce365 periods editor / affected list resets, e9fc532 closure form + admin form posts), and the 4-commit final fix wave after a multi-dimension final review (bf20f55, 0640681, 86f11a2, 75106f7).

Final gate on 75106f7: typecheck; lint exit 0 (19 warnings); 53 files / 601 tests; build; check-prerender; E2E 118 passed three times in a row (one run with `TZ=UTC`); visual 8 passed at ratio 0.

## Rulings (in the order they were made)

- - Ruling: implement by cherry-picking each p4-folded commit + reconcile + RED + full gate — same proven method as phases 2–3 — if wrong: reconciliation misses are caught by the per-task review.
- - Ruling: accept plan rulings R1–R16 as written (argued in the plan, reviewed in the planning workflow) — if wrong: small follow-up migrations / client changes before phase 5.
- - Ruling (plan risks "Cần quyết định"): #1 pg_trgm on Neon PG18 — controller runs the read-only pre-flight queries on Neon before applying 006 (stop if pg_trgm unavailable); #2 advisory xact lock via Neon pooled URL — controller verifies with a harmless two-connection lock probe on Neon after 006 (advisory locks write nothing), fallback per spec §16 if it fails; #3 raw 500 after updateTag while DB down — accept, phase 10; #4 updateTag reach across Vercel instances — check on first preview; #8 non-bookable restaurant card non-clickable / empty drawer if all off — accept, revisit with "Gọi để đặt bàn" in phase 6/7; #9 04:00 service-day rollover, staff can't book inside a closure, batch cancel per booking — accept defaults, surface to the user; #16 E2E load / page-scope flake — monitor, CI retries:1 — if wrong: issues surface at first preview / launch A, none corrupts data.
- Ruling: fix Task 1 Important 1 now (normalize(value, NFC) + strip U+0300–036F inside fold_search, with an NFD test case) — code rule 6 + spec §7.2 search by name; 006 is unapplied everywhere so the fix is free now and costly later — if wrong: none (NFC input unchanged).
- Ruling: pull Minor 1 into the same round — add uppercase→lowercase translate pairs for every Latin-1/Latin Ext-A/Vietnamese letter that NFD does not decompose (Ø, Æ, Ł, Œ, Þ, Ħ, Ŋ, Ŧ …) and make the equivalence test cover every letter of those blocks under COLLATE "C" (tests force C; Neon's builtin provider lowercases, but local/CI collations may not) — if wrong: none.
- Ruling: fix both Task 6 Importants now (a real guest-facing failure path and a time-of-day flaky test) — spec §12 error handling + reasonable-guest expectation outrank the plan's verbatim code — if wrong: none.
- Ruling: pull into the same round the guest-facing cheap minors: drawer maxLength (T4), error.closed copy for meal-only closures (T4), DayStrip note surviving a restaurant switch (T6) — later p4-folded commits touch only SiteProvider.openRestaurant (~l.404, T11) among these files, so the fix must leave that region alone — if wrong: small extra diff, same gate.
- Ruling: fix the page-scope.spec.ts:71 race in the phase-4 final fix wave (test waits for hydration before recording, or PageCurtain skips the same-value write) — its failure rate rose to ~40% of full E2E runs under load and it masks the desktop-serial switch spec — if wrong: CI retries:1 still absorbs most.
- Ruling: fix both Task 11 Importants now (submitKeepingValues/onSubmit pattern; key the AffectedList form on items' id:version) — staff could save a schedule different from the one shown; spec §12 keep entered data — if wrong: none.
- Ruling: the fixer also runs brief Step 10's two negative controls (removing updateTag) to evidence the acceptance "guest sees new slots immediately" in this checkout.
- Ruling: fix both Task 13 Importants now — silent revert of another editor's change is data loss; spec code rule 9 — if wrong: none.
- Ruling: pull into the same round (T14 touches only README + acceptance spec, so no cherry-pick conflict): T12 blank leadMinutes → required error; T12 AutoConfirmForm keep values on refusal; and the method="post" sweep for every submitKeepingValues form (RulesForm, NewReservationForm, EditReservationForm, SettingsForm, ClosureForm — Task 9 PII-in-URL item) — if wrong: small diff, same gate.
- Ruling: fold Task 14's Important (README data map) and its minors (README "nothing cached" wording, dedupe wording, SELECT * expectation, preview check must re-enable booking, pg_trgm CREATE privilege note; acceptance spec: scope A1's pg_locks count to current_database(), comment fixes, audit_log 0 assertion) into the final fix wave — docs/test-only, no behaviour risk, one gate run covers all — if wrong: stale docs for one more wave.
- Ruling: accept the final-review triage, except SEC-2 (guest PII in the inbox search GET URL → Vercel request logs): owning phase moved from 10 to 5, so it is fixed before launch A — real guest data goes live at launch A — if wrong: one phase earlier than needed.
- Ruling: accept the convention "a form with a function action takes no onSubmit" (DeleteClosure's confirm moved to the button's onClick) — React refuses method on function-action forms and those never GET — if wrong: one confirm moves back.
- Ruling (residuals parked): calendar retry in flight + REQUEST BOOKING restarts the calendar request (phase 7 form/drawer polish); strip live region unmounts on the failed-calendar path (phase 7); '−' Fewer guests still uses disabled at 1 guest (focus to body, phase 7); session-first guard checks only awaited reads (phase 10); page-scope curtain test second failure mode — a guest client RSC request answered 404 (x-nextjs-postponed) while an admin save ran updateTag('restaurants') in parallel → hard reload, reproduces on 04e0692 — investigate in phase 6 (guest pages move to DB-driven cache) or phase 10 alongside phase-2 ruling 7 — if wrong: a guest occasionally gets a full reload instead of a soft navigation during an admin save.

## Final review triage: deferred and dropped items

## Rulings made at triage

- **Ruling (SEC-2, inbox search as GET) — controller override:** guest phone/name/email in the inbox search URL reach Vercel request logs; phase 5 (before launch A) owns the fix (e.g. POST the search to an action and keep `q` out of the URL), not phase 10.
  - Why it can wait:
    - Staff can reach it only after signing in.
    - The app logs no personal data itself.
    - The project has no log drain.
    - The shared-PC history risk is the same kind as the inbox itself showing guest data on screen.
  - The fix is a design change: move `q` off the URL (a POST that stores it in a short-lived httpOnly cookie, or a Server
    Action that returns the rows), and drop `q` from the proxy's sign-in `next`. It belongs with phase 10's privacy work:
    anonymiser, retention, log review.
  - If wrong: guest phone numbers, names or emails stay in platform request logs and browser history until phase 10.
  - The user may pull this into phase 5 if launch A must have no PII in URLs.
- **Ruling (SEC-3, the anonymiser contract for phase 10):** this replaces plan Known risk 13's wording. F20 corrects the
  comments in 006.
  - Anonymise `reservation_events.changes` by **allowlist**:
    - keep `date`, `time`, `guests`, `over_capacity`, `source`, `note_id`;
    - drop every other key: `name`, `phone`, `phone_e164`, `email`, `note`, and any key added later.
  - NULL `reservations.status_reason` and `reservation_events.reason`, both free text staff type about a guest.
  - Add a test asserting that `/admin/audit` (`audit_feed.after`) and the booking timeline show none of the dropped values
    after anonymising.

## LATER, by owning phase

### Phase 5: email, outbox and anti-spam (launch A)
- `submitReservation` step-3 checks run inside the booking-day lock, so a burst costs lock time (T4). Phase 5's BotID,
  honeypot and per-phone limit sit in front of the lock.
- `/api/availability` checks the range only after `loadRestaurantRules`: a DB round trip, and 404 is answered before 400
  (T5). Phase 5's anti-spam pass should answer the cheap 400s before any query.
- A 404 `restaurant_unavailable` (a restaurant switched off while the drawer is open) shows `error.network` with a futile
  Try again (T6). Phase 5 adds new drawer error codes (`consent_required`, `too_many_requests`, `bot_blocked`), so the drawer's
  error mapping is reworked there anyway.
- Try again unmounts its own focused button, so focus goes to `<body>` inside an aria-modal dialog, and a double failure
  shows a double alert (T6). Same drawer error-path rework.
- The BookingBar shows nothing when the calendar fails (T6). Same rework. The drawer, which is where booking happens, does
  show the failure.
- The audit-label guard reads only 006's `reservation_events.type` CHECK (T7). Phase 5 replaces that CHECK when it adds
  email events; read the live constraint then.
- A null `actor_label` reads 'người khác' in conflict messages (T8). This only matters for phase-5 guest events (unsubscribe
  and similar); label them when they are added.
- The guest's done screen and the `guest.ack` / `guest.confirmed` emails must use the same wording for each status (GX-1
  verifier note; F2 adds the two done-screen keys). Phase 5 writes the emails.
- When raising `serverActions.bodySizeLimit` to 2 MB (spec §11), scope the raise to the admin upload actions if Next allows
  it, so `submitReservation` stays small (SEC-1 verifier note). F1 already bounds the regex.

### Phase 6: content to DB
- `ORDER BY r.sort_order` in the rule loaders has no `r.id` tiebreaker (T3). Seed sort orders are unique; phase 6 makes them
  editable.
- No test covers a null `groupPhone` (T3). The group phone comes from `restaurants.phone_*`, which phase 6 adds; test it then.
- No open day and no group phone means the drawer says nothing (T6). Risk 8's "Gọi để đặt bàn" action and phase 6's phone
  numbers settle it.
- The SearchOverlay result for a switched-off, reserve-only restaurant is a dead click (T11). Risk 8, same "Gọi để đặt bàn"
  action. F7 only removes the card's clickable look.

### Phase 7: editors, media and form kit
- NoteForm and TransitionPanel lose typed text on a refused save (T9). The form-kit item.
- `EditReservationForm` uses `key={r.version}`, so a status change remounts it and drops typed edits (ADM-1 side note). The
  next save says "Không có gì thay đổi". Form kit, together with the item above.
- The "Xem" button on "Xem trước giờ đặt" reloads the page and throws away unsaved period and rule edits (ADM-3). It needs
  the form kit's unsaved-changes guard, or client navigation for the preview.
- A QuickConfirm conflict lacks "Tải lại", and its alert goes stale after a refresh (T9).
- Field errors are found by text, with no `aria-invalid`; plus admin a11y nits (T9). Form-kit field primitives.
- Per-row period errors never render: zod flatten files nested issues under `periods`, and the message shows without its
  row (T11).
- Duplicate accessible names, and weekday checkboxes without row context, in the periods editor (T11).
- An emptied covers field becomes 0 at once. The value is visible in the field, but typing is awkward (T11). Form-kit
  number inputs.
- The default row from "Thêm ca" (Breakfast 18–21) is refused by R6 when it sits next to Dinner (T11). Pick a non-overlapping
  default.
- Deliberate staff overbooking is listed as "vượt sức chứa mới" (T11). Wording.
- Closure section titles omit the meals, so two closures on the same dates look identical (T13).
- `.a-inline` duplicates `.a-inline-form` (T13). CSS consolidation.

### Phase 8: i18n
- `locale ?? 'en'` is hard-coded in the guest submit path (T4).
- The `{phone}` translator context says "the restaurant's number", but it is the destination's group number (T4). The same
  goes for `booking.no_dates`.
- The `booking.day_past` translator context lacks "keep short" (T6).
- `writeReasons` deletes every `closure_i18n` row on any closure edit, which would lose phase-8 machine translations (T13).
- The closure card shows only the EN reason (T13).

### Phase 10: hardening (launch B)
- SEC-2 (ruling above) and the SEC-3 anonymiser contract (ruling above).
- Staff `actor_label` is "Name (email)": editors see other staff members' emails on timelines and in conflicts, and the
  email outlives a deleted account (security declined note). Decide whether to keep it during the staff-data review.
- NUL bytes or invalid UTF-8 in guest fields make Postgres throw 22021, which the guest sees as `error.network`
  (security declined note). Refuse `\u0000` in zod.
- The guest-site static CSP from spec §11 does not exist yet (security declined note).
- An edit can move a `seated` booking to another date (booking declined note). Consider restricting edits of seated
  bookings to the same service day.
- The overview's "đặt bàn hôm nay" counts only holding bookings, but its link opens the "Hôm nay" tab, which lists every
  status (admin declined note).
- CHECK coverage gaps in `migration-006.test.ts`: settings and override bounds, whole-minute cutoff, `status_reason` ≤ 500,
  `version` ≥ 1, and the unlabelled system event staying NULL in `audit_feed` (T1).
- An invalid `TEST_DB_TAG` is silently ignored, and the doc comment overstates parallel use (T1). Test infrastructure.
- The "beyond the blocks" fold test assumes a non-C cluster default collation (T1). True locally, in CI and on Neon.
- `period.reason` takes `wholeDay[0]`, or the first meal closure, even when a later closure has the public reason (T2).
  Rare: it needs overlapping closures. The day-level reason already picks one that has a reason.
- `clockBlock` recomputes `venueNow` per slot (T2). Performance over 92 days.
- The tie-break test does not exercise `firstSeating`, and the `intervalMin <= 0` guard is untested (T2).
- `loadBookedCovers` date bounds are not pinned by a test (T3).
- The comment on `lock_timeout` should say that it also bounds later row locks in the transaction (T3).
- Shared seed state leaks when running with `-t` (T3). Test infrastructure.
- `REFERENCE_ATTEMPTS = 3` is not pinned by a test (T4).
- A stale pool comment (T4).
- `DEFAULT_PARAMS.max` duplicates the default (T4).
- The 503 log in `/api/availability` lacks `err.code` (T5).
- Availability tests miss: 503, the 91/92-day boundary, cache-control on the day form, the from-only defaults, and date
  precedence (T5).
- `openReserve` plus the effects fetch twice, up to 4 requests (T6). Risk 7 accepts two. F4 stops the submit from adding more.
- An unmatched audit cursor shows "Chưa có mục nào." with no pager (T7).
- `audit_feed.after.changes` is no longer asserted (T7). Pair this with the anonymiser test.
- The `client-ip.ts` comment is inaccurate, and the file has no `'server-only'` (T7). Its `node:net` import already keeps it
  out of client bundles.
- The newest-page audit E2E assumes fewer than 50 parallel feed rows (T7). Re-checked; no worse than recorded.
- `over_capacity` is not re-evaluated when an edit shrinks the party (T8).
- `same_service_day` uses the calendar date for sittings before 04:00 (T8). No period crosses midnight today.
- `editReservation`'s `not_found` and all-reference-collision branches are untested (T8).
- A punctuation-only search (e.g. "--") matches every booking (T9).
- The `opensAt` hint does not wrap midnight (T9).
- `UPCOMING_STATUSES` is hard-coded in `queries.ts:67` (T9), and `NOT IN ('cancelled','declined')` is written by hand (T10).
  Code rule 2 hygiene.
- Between 00:00 and 04:00 the new-booking page defaults to the previous service day, which the phone rule refuses as past
  (T10). Rare hours; staff can pick today.
- Sequential awaits, and a duplicate `listRestaurantOptions` call, on the new and day pages (T10). Performance.
- A batch cancel that throws returns a generic error, with no counts and no refresh (T11).
- A no-op save of periods, rules (T11) or a closure (T13) still writes an audit row and moves the token. Harmless once F10
  keys forms on their own data.
- The unknown-period-id conflict branch and the batch skip count are untested (T11), and there is no test for a cancel that
  leaves rows (T11 fix).
- A post-COMMIT `listRestaurantBookings` failure reports an error for a save that committed (T12). Needs the DB to fail
  right after COMMIT.
- The settings conflict params are untested (T12).
- The affected list loads every restaurant's bookings for each closure (T13). Performance.
- Closure test gaps: the update audit keys, the `editClosure` UI, old∪new tag expiry, `?? row.meal` (T13).

## DROP

- `reservation_search_text` is declared IMMUTABLE but calls the STABLE `concat_ws` (T1): harmless with all-text arguments,
  and only the trigger calls it.
- `Boolean(seen.add())` side effect (T2): style only.
- Task 2 Step 7 boundary mutations not re-run (T2): process; the engine tests have since been exercised by every later gate.
- Alias `d` reused (T3), and an imprecise UTC comment (T3): cosmetic.
- A bare `50` literal (T5): cosmetic; the bound is pinned by the availability tests.
- The `bookingEnabled` doc comment was ahead of T6/T11 (T5): those tasks landed, so the comment is now accurate.
- E2E RED step skipped (T6) and RED steps skipped (T13): process, and the per-task reviews covered both.
- The audit cursor regex rejects dates before 1970 (T7): no audit row predates the project.
- A dead `.replace(/[ILOU]/g, '7')` in the admin-audit E2E (T7): a no-op on hex input, and the test's assertions are unaffected.
- `conflict()` could order by `id` instead of `at` (T8): equivalent result.
- `SOURCE_LABELS` typed as `Record<string, string>` (T8): style.
- `.a-noprint` used before it is defined (T9): CSS source order does not matter for a class selector.
- The closure action expires the old scope's tags from hidden fields (T13): the token check means the hidden fields equal the
  stored scope, unless an authenticated `schedule:update` user forges a post. Under R2 nothing reads the `booking-rules:<id>` tag.
- The guest learns from a "duplicate" answer whether a phone already holds a booking at that restaurant, date and time
  (security declined note): this predates phase 4, and every probe that misses creates a real booking, so probing is noisy.
- GX-3's extra "Next available: {date}" note: F3's scroll-into-view shows the selected day, and tapping a greyed day already
  gives its reason.
