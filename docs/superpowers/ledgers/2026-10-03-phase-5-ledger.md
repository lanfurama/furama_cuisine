# Phase 5 ledger — SMTP email and anti-spam

Plan: `docs/superpowers/plans/2026-10-02-phase-5-email-anti-spam.md`. Spec: `docs/superpowers/specs/2026-10-01-admin-cms-design.md` (amended 47ad5ee: SMTP instead of Resend, at-least-once delivery).

Executed on `main` from 4a66014 to 8fe98f5:
- 13 task commits, each cherry-picked from the verified clone and given a task review.
- 4 review-fix commits during the tasks:
  - d0108cd: the guest-email choice survives a refused cancel.
  - 022a8de: a readable header on the privacy page.
  - a1f1640: focus stays inside the booking drawer.
  - 27877d6: BotID logs every failure, and a half-configured BotID never refuses guests.
- The final fix wave after a multi-dimension final review: 8ae8292, b0b49a6, f935d24 and 29311e7.
- One residual fix: 8fe98f5.

Final gate:
- typecheck clean; lint exit 0 with 19 warnings.
- Unit and integration: 68 files, 906 tests.
- build and check-prerender pass (including the inlined-env rule).
- E2E: 151 passed and 1 skipped (the opt-in BotID spec, which passes on its own server). Runs on the wave's final gate tree: 3 × 149, one of them with `TZ=UTC`.
- Visual: 8 passed at ratio 0.

Owner decisions recorded:
- Traditional SMTP replaces Resend (2026-10-02).
- Vercel is on Pro.
- Neon is already on a paid plan, so the 5-minute outbox cron stays (2026-10-03).
- Proceed with the plan's recommended rulings R1–R23.

Launch-A owner steps (README "Before launch A"):
1. Migration 007 first. Done on Neon 2026-10-03.
2. Neon paid plan. Done.
3. Vercel project settings: expose system environment variables, OIDC, Fluid Compute.
4. SMTP account and EMAIL_FROM.
5. SPF, DKIM and DMARC.
6. Production on `redirect` until go-live, then `live`. The code refuses `live` on Preview and Development.
7. CRON_SECRET of 16 or more characters.
8. BotID first-preview checks.
9. A privacy text reviewed by a lawyer, in EN and VI.

Note: in one task an agent printed its shell environment once into its local transcript. No `.env.local` content was included.

## Rulings (in the order they were made)

- - Ruling: implement by cherry-picking each p5-folded commit + reconcile + RED + full gate (proven in phases 2–4) — if wrong: reconciliation misses are caught by the per-task review.
- - Ruling: accept plan rulings R1–R23 (the owner said to proceed with the recommendations) — if wrong: each states its own small follow-up.
- - Ruling (plan risks "Cần quyết định"): #2 outbound 587/465 from Vercel, #7 BotID needs system env vars + OIDC — check on the first preview ("Gửi email thử", a booking); #3 provider limits and #4 deliverability (SPF/DKIM/DMARC, From) — owner + IT Furama when the SMTP provider is chosen; #8 BotID fail-open in 3 s and verified bots refused — accept; #10 privacy text is an EN draft pending a lawyer and a VI text — accept for launch-A code, owner must supply reviewed text before launch A — if wrong: surfaced at the first preview/launch, no data corrupted.
- Ruling: fix Task 3 Important 1 now (controlled checkbox reset only on ok, or submitKeepingValues keyed on version) + E2E (untick → refused → still unticked → cancel → no email_outbox row) — emailing a guest against the staff's explicit choice is a real harm — if wrong: none.
- Ruling: pull in the R8 hint minor (show "Lý do này sẽ được gửi cho khách." only when the booking has an email and the action is cancel/decline) and a test that bulk cancel forwards notifyGuest — same files, later tasks never touch TransitionPanel/AffectedList/NewReservationForm (checked).
- Ruling: fix Task 8 Important now with CSS only (solid header on hero-less pages, e.g. html[data-view='other'] .hdr …) — T9/T10 cherry-picks edit SiteProvider.tsx, so the JS route is avoided; add an E2E/visual-style assertion that the header text contrasts with the background at scroll 0 on /en/privacy (desktop + 390 px) — if wrong: none.
- Ruling: pull in Task 8 cheap minors: `.legal .legal-updated` specificity, privacy page openGraph, CLIENT_KEYS contains booking.privacy_notice/booking.consent/legal.link assertion.
- Ruling: fix Task 10 Important now (arm the restore whenever focus is inside .load-failed; fall back day/time → .load-failed (tabIndex -1) → section anchor → drawer; E2E for the re-ask path) — keyboard/AT users lose their place in a modal; T11–T13 never touch the drawer files — if wrong: none.
- Ruling: pull in cheap a11y minors in the same files: T9 consent error aria-describedby via useId; T10 test that REQUEST BOOKING focuses .load-failed; preventScroll on the restore focus().
- Ruling: fix Task 11 Important now (non-boolean isBot → throw into the logged fail-open path, with a test) — R16 requires a log whenever BotID fails open — if wrong: none.
- Ruling: also close the client/server gate mismatch: the server decides "BotID is on" from the same signal the client used (NEXT_PUBLIC_VERCEL_ENV, present at both build and runtime only when system env vars are exposed), so a misconfigured deployment fails OPEN with a one-time warning instead of refusing every guest — a launch-blocking failure mode for a restaurant booking site — if wrong: BotID off on a misconfigured deploy, visible in the log.
- Ruling: pull in Task 11 minors: refuse isVerifiedBot===true too (R16 whichever convention the API uses); restore globalThis.XMLHttpRequest in botid.test afterAll; import DEPLOYED instead of redefining it.
- Ruling: accept the triage; B6 is fixed in the runbook (Neon Launch plan required for the 5-min cron, with the quieter-schedule alternative documented) and surfaced to the owner as a cost decision — if wrong: the owner picks the hourly/overnight schedule instead, a one-line vercel.json change.
- Ruling: fix both re-review Minors now in one small commit (notice/notTold must agree with the drain's past-sitting skip; a 5.1.x enhanced code means a mailbox-side refusal and wins over the sender-blame wording, so bad guest addresses fail at once with the right hint) — both mislead staff during launch A and are one-liners with tests — if wrong: none.
- Ruling (parked): 5.7.x recipient-policy refusals retried ~19 h with the EMAIL_FROM hint (triage ruling 2 as written) — phase 10 hardening; listGuestContacts after commit can lose the call list on a DB error (negligible) — phase 10.
- Ruling (parked): RECIPIENT_CODE matches 5.1.N inside an IPv4 in the raw reply (very unlikely; an own-IP RCPT refusal would fail at once instead of retrying) — phase 10: strip dotted quads or anchor the code after the reply code; TransitionPanel/AffectedList still offer "Báo khách" + the reason hint for a sitting that has passed, and the single-cancel notice does not say why no email went — phase 7 form kit.

## Final review triage: deferred and dropped items

## Rulings made at triage

1. **Booking emails stop once the sitting has started.**
   - All five events are skipped from that point.
   - The overview counts only the failed and retrying emails of sittings still ahead (R21's "one WHERE clause").
   - The "Lỗi" tab still lists every failed row.
   - No "Bỏ qua" action is added.
   - If wrong: the event set is one constant, and the count is one WHERE clause.
2. **A 5xx at `RCPT TO` that blames the sender, a relay or the login is retried.** This covers enhanced codes `5.7.x` and wording about the sender or relay. Only a mailbox refusal fails at once (this narrows R6). If wrong: such a row is retried 6 more times over 19 h.
3. **`error.network` and `error.restaurant_unavailable` carry `{phone}`, shown as a `tel:` link (spec §12).**
4. **BotID's browser half gets a 15 s deadline on its challenge step only.** A request already handed to the network is never cut.
5. **T13.5 (A4's duplicate overview assertion) is DROPPED, overriding its "final wave" mark.** The reason is given in the DROP list.

## LATER, by owning phase

### Phase 6: content to DB (the rest of `site_settings`)
- **T6.2.** The notifications screen tells staff "Từ đợt 6…", project jargon they will not understand. Phase 6 rewrites that sentence when the footer starts reading `site_settings.email`.
- **T6.8.** Two readers of `site_settings.email`. Merge them into one when phase 6 adds the table's other columns.
- **Phase-6 handoff** (delivery declined note):
  - Once the footer reads `site_settings.email` under the `content:contact` tag, `saveSharedInbox` (`lib/server/email/recipients.ts:167-183`) must also call `updateTag` for it.
  - The privacy page's `{email}` still comes from `CONTACT`; move it with the rest.
- **The Dining House destination's `phone_display` `0859 555 759` has no +84** (delivery declined note). Foreign guests get a domestic number in the email's text part.
  - Phase 6 moves phone numbers to the DB.
  - Spec §15 item 14: the owner confirms the number.

### Phase 7: editors, media and the form kit
- **admin F5.** Browser Back from a second inbox search to the first shows "Kết quả tìm kiếm đã hết hạn" in the same tab: the cookie holds one search. Keep the last few `[id, q]` pairs, say five, well under 4 KB. The 30-minute lifetime and the URL privacy stay as they are.
- **T5.1.** The `staff.new` intro "đã tự động xác nhận" is chosen at send time. A retried email for a booking confirmed by hand in between says "auto". Take it from the created event that `reservation_event_id` points to. It belongs with the email editor (`/admin/content/emails`).
- **T5.3.** Guest email key lists are duplicated. Merge them when phase 7 makes `email.*` editable.
- **T5.5.** No test checks that a reviewed `vi` `content_strings` row beats the registry. Add it with the email editor.
- **T6.6.** The recipients form's events `FieldError` is not linked with `aria-describedby`. Form-kit field primitives.
- **T6.9.** The recipients list shows the locale code (`vi`) instead of its name.
- **T7.4.** Duplicate accessible names on the "Gửi lại" buttons in the booking's email table. The log already labels them.
- **T7.5.** The audit row for "Gửi lại" reads "Email · <id>", with no link to the booking.
- **T7.6.** The resend button stays enabled after a success. Plan risk 24 explains the notice; disable it until reload.
- **T8.1.** `content:ui` and `content:legal` cache coupling once phase 7 lets editors save `legal.*`.
- **T8.2.** The policy version hash pins only the registry's EN defaults. Phase 7 makes the version the time of the save.
- **T8.4.** `WithEmail` links only the first `{email}`.
- **T12.4.** The void `searchReservations` action lets a PermissionError reach the generic error page. Plan-mandated; it belongs with the form kit's action-error handling.
- **T12.5.** Reloading page 2 of an expired search shows "← Trang đầu".
- **Duplicate element ids while Next keeps earlier admin pages mounted in `<Activity>`** (admin declined note). After moving from booking A to booking B, two `#res-transition-reason` exist, so `htmlFor` and `aria-describedby` resolve to the hidden copy. Use `useId` in the form-kit pass.
- **Carried from phase 4:** scope a raise of `serverActions.bodySizeLimit` to the admin upload actions, so `submitReservation` stays small.

### Phase 8: i18n
- **GUX-5.** English guest emails use US formats ("Tuesday, October 6, 2026", "11:30 AM"). The booking screen and the privacy page are day-first with a 24-hour clock. Choose the English email locale (`en-GB`) and the 12- or 24-hour clock once for the site and the emails. The ICU strings pinned in `render.test.ts` move with it.
- **T5.2.** `ownCopy('en')` is always false. This matters only if `vi` becomes the default language.
- **T5.4.** The translator context's date example is wrong.
- **T8.3.** A non-`en` locale shows the EN policy text under a localised date.
- **R10 for a language enabled later** (delivery declined note). A guest whose language has no reviewed `email.*` rows would get English text with that language's dates. Gate enabling a language on its `email.*` rows. Risk 19 covers staff only.

### Phase 9: Vertex AI
- Nothing from this review. When phase 9 adds the 5-minute `/api/cron/ai-jobs`, the production compute is already always on (F24): no new cost note is needed. Mention it in phase 9's runbook.

### Phase 10: hardening (launch B)
- **T1.2.** No test ties the `notification_recipients` events CHECK literal to `STAFF_EMAIL_EVENTS`. The audience rule is written two ways.
- **T1.3.** The migration-007 re-run test depends on the previous test's insert.
- **T1.4.** `email_outbox.reservation_event_id` has no index. Its `ON DELETE SET NULL` scans `email_outbox` when retention starts deleting `reservation_events`. Add the index in the anonymiser's migration.
- **T1.5.** Untested CHECKs: `message_id` and `provider_id` length, an unknown scope, restaurant scope with a `destination_id`, `site_settings.email` over 254 characters.
- **T2.2.** `sendStaffInvitation` and `sendPasswordReset` are not `async`, so an `appOrigin()` failure throws synchronously. Make them async.
- **T2.3.** The password test has no leading or trailing spaces, so a trim regression would go undetected.
- **T2.5.** The invite-link tests read the runner's `process.env`.
- **T4.3**, the reaper part. A reaped row keeps its attempt-6 error, and no `[outbox] failed` line is logged for it. Log one line per reaped id (`RETURNING id`).
- **T6.4.** No `sendTestEmail` test for `missing_app_url` or for `live` on a Preview.
- **T6.5.** No E2E for an Editor's direct POST to `sendTest`. The guard table covers it.
- **T7.3.** The overview's reads run one after another, and `restaurantsWithoutRecipient` also runs for Editors.
- **T8.5.** Locale resolution is repeated.
- **T8.6.** The build drops the unprefixed `backdrop-filter`, so Chrome draws no blur on the solid header. Pre-existing.
- **T8.7.** Inline styles in the guest not-found and error pages. Pre-existing; this matters for the guest CSP.
- **T9.1.** A `null` honeypot (a non-browser POST) is refused by zod as invalid, without the `[booking] refused as a bot` log line.
- **T9.2.** The privacy link opens a new tab without a screen-reader hint. Guest a11y pass; needs a registry key.
- **T9.3.** In the honeypot test, the spy is restored outside `finally`.
- **T10.1.** The `RESTAURANT_ID` regex duplicates `RestaurantId`.
- **T10.2.** The BookingBar status region is not inert behind the open drawer, so it may be read twice.
- **T10.3.** Document that a day request with a bad `from` or `to` now answers 400 (the README Routes section).
- **T12.2.** The search pager is checked to be free of `q` only by inspection. Add a test with more than 50 matches.
- **T12.3.** The search normaliser is duplicated (`inbox-search` and `parseSearch`).
- **T12.6.** `other.close()` sits outside `finally` in the search E2E.
- **Focus drops to `<body>`** after REQUEST BOOKING, because the button becomes `disabled` while pending, and again when the done screen replaces the form (guest-ux declined note; pre-existing since phase 4). Use `aria-disabled` while pending, as the guests stepper does, and move focus to the done screen's heading. Guest a11y pass.
- **Visual cold-start flake** (guest-ux declined note). The first visual run after a cold `next start` failed `nojs-home` on the story images' load timing; reruns passed. The fix wave's gate warms the server. Make the nojs spec wait for those images to decode.
- **A fail-closed `VERCEL_ENV` check** (delivery declined note). When `VERCEL` is set but `VERCEL_ENV` is not, refuse `live` and warn once. Until then, F26 documents that the system variables are required.

## DROP

- **T1.1.** The Step 8 NULL-trap mutation was not run. This is process: the reviewer checked the CHECK by hand, and `migration-007.test.ts` covers it.
- **T1.6.** `maskEmail` splits an astral first character. Cosmetic: it needs an address that starts with an emoji, and the full address is one click away on the booking.
- **T3.2 and T7.8.** Import order. Cosmetic; lint passes.
- **T3.3.** An unused `afterEach` restore in a test. Dead code with no effect on any result.
- **T3.4, T5.6, T6.10 and T13.6.** Gaps in the reports and the RED evidence (raw output, failing test names). Process only, nothing in the tree to change, and every task review covered them.
- **T4.3**, the third-copy part. A delivered-but-unrecorded 7th send ends `failed`, and "Gửi lại" may send a third copy. This is the duplicate window R1 accepts, and it is plan-mandated.
- **T4.6.** `drainAfterCommit` is scheduled with an empty list in `changeStatus` but only when non-empty in `cancelReservations`. Both are correct: the difference only decides whether an unrelated due row is swept a little earlier.
- **T5.7.** The Node 24 ICU strings are unconfirmed. This is accepted risk 11: CI on Node 24 confirms them on the first push, and the fallback (loosen to "contains") is already prescribed. It cannot be checked on Node 22 locally.
- **T6.1.** The test email reads `EMAIL_REDIRECT_TO` from the environment instead of the sender's result. At runtime both are the same value.
- **T6.7.** `recipients.ts` mixes the queue helper and the admin CRUD. Structure only.
- **T13.5.** A4's overview assertion in `booking-email.spec.ts` repeats `admin-emails.spec.ts:93-96`.
  - This is the "final wave" mark override.
  - Keeping it makes the acceptance file prove spec §14.1 row 5's A4 on its own, at the cost of one sign-in.
  - Removing either copy loses something: self-containment or the feature test.
- **SEC declined: the per-phone check (R14) acts as an oracle before the rule checks.** This is an accepted ruling, and the value is low.
- **SEC declined: `redactEmails` misses quoted or commented local parts.** Theoretical: nodemailer normalises these addresses before `RCPT`, so stored SMTP errors carry the plain, redactable form.
- **SEC declined: `GUEST_EMAIL` accepts the name-addr form `"X"<a@b>`.** A guest can type any address anyway; this is the accepted R13 pattern.
- **SEC declined: `resolveMode` allows `live` on a local server with `VERCEL_ENV` unset.** This is operations: the global rules forbid `SMTP_*` locally.
- **guest-ux declined: the consent box stays ticked after Escape closes the done screen.** It was ticked by the same person, and the form part predates phase 5.
- **admin declined: a partial bulk cancel re-ticks "Báo khách qua email".** This is by design (the form is keyed on the list, a phase-4 ruling), and staff get a fresh form with an empty reason.
- **tests-ops declined: under `--repeat-each=20`, two parallel copies of `booking-email` can draw the same `Date.now()` phone suffix.** It happens only under stress, never in a normal or CI run.
- **The overnight cron schedule as a fix for B6.** Spec §10.4 sets the 5-minute cadence, a pause would stall retries overnight, and phase 9 adds another 5-minute cron. F24 documents the Neon plan instead, and records the UTC schedule as an owner option.

## Applied to Neon (2026-10-03)

Pre-flight (read-only), all as expected:
- `_migrations` held 001–006.
- None of 007's tables existed.
- Postgres version is 13 or newer.
- The consent columns did not exist.
- There were 0 reservations.

Migration 007 was applied with `scripts/migrate.mjs`. Post-check:
- `site_settings.email` is `fb@furamavietnam.com`.
- `email_outbox.idempotency_key` is a generated STORED column.
- There are 0 notification recipients, so new-booking emails go to the shared inbox until the Admin adds recipients.
- `reservations_consent_check` is present.
- There are 0 outbox rows.
