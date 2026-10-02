# Phase 5 plan outline: Email và chống spam → mốc ra mắt A (bản EN)

Scope: spec `docs/superpowers/specs/2026-10-01-admin-cms-design.md` §14.1 row 5: outbox; templates EN/VI (copy from the registry); send after commit; cron; recipients and "Gửi email thử"; email log; environment gate; privacy page and consent checkbox; honeypot, per-phone limit, BotID. Details in §5.2, §7.2, §10.2–10.4, §11–§13, §15. Acceptance: a new booking emails staff; confirming emails the guest; a failed email is retried; with no recipients it goes to the general email; bots are blocked.

**User decision (2026-10-02), binding over the spec:** no Resend. All email (staff invite/reset and the outbox) goes through traditional SMTP via nodemailer. Vercel is on Pro, so Vercel Cron is available. §2.0 gives the spec amendment for the controller.

Folder: `/Users/bcmac/Desktop/projects/Outside Projects/furama_cuisine/docs/superpowers/research/2026-10-02-phase-5-spikes/`. It holds this outline and three spike reports:
- `outbox-core.md` (clone `p5-outbox`, patch `p5-outbox.patch`): migration 007, SMTP transport, outbox queueing, lease-based drain, `after()`, cron, `vercel.json`.
- `templates-screens.md` (clone `p5-templates`, commit `ad4c3eb`, patch `p5tpl-logs/p5-templates.patch`): registry email copy EN/VI, rendering, email log and "Gửi lại", notification settings, "Gửi email thử", overview counts.
- `anti-spam-consent.md` (clone `p5-guard`, patch `p5-guard.patch`): BotID, honeypot, per-phone limit, consent and privacy page, SEC-2, cheap availability answers.

Clones and patches live under `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/`. Where a report and this outline disagree, **this outline wins**. §0 lists every conflict and how it was settled.

## 0. What I checked myself, on top of the three reports

**State**
- I wrote only this folder in the main repo. I ran no build, test or server, created no database, and touched no port.
- When I began, `main` was at `bf20f55` = phase 4's final fix wave **group A** (F1–F8: zod `abort` bounds on email/phone, `booking.done_requested`/`booking.done_confirmed`, the `SiteProvider`/`ReserveDrawer` rewrite, F6 copy, F8 curtain). While I wrote, groups B and C landed (`0640681` "book where the admin picker points, and keep unsaved input across saves", `86f11a2` "guard the admin pages' session check and post forms, and pin the edit lock"); group D (migration-006 comments, README) and the wave's gate/review were still to come. The working tree was clean apart from this folder.
- All three spikes are based on `04e0692`, before the wave, with its RED test files reset. **The plan drafter re-bases every task on the final phase-4 HEAD.** Files that collide: `create.ts`, `input.ts`, `app/actions.ts`, `SiteProvider.tsx`, `ReserveDrawer.tsx`, `registry.ts`, `NewReservationForm.tsx` (+ the new `TargetPicker.tsx`), `TransitionPanel.tsx`, `AffectedList.tsx`, `reservations/actions.ts`, `admin-reservations.spec.ts` (F18), `README.md` (F21).
- I read the outbox drain (`p5-outbox/lib/server/email/drain.ts`), the templates' `render.ts`, `events.ts` and `test-email.ts`, the guard's `create.ts` diff, the nodemailer package, the Next docs cited below, the spec, the phase-4 plan header, the phase-3 ledger and phase 4's `final-deferred.md`.

**Facts the decisions rest on**

| # | Fact | Where |
|---|---|---|
| F1 | `reservation_events.type` CHECK = {created, status_changed, edited, note_added}. `audit_log.action` CHECK = `^(create\|update\|delete\|reorder\|restore\|settings\|staff\.[a-z_]+)$`. | `006_booking_v2.sql`; `005_staff_auth_audit.sql:107-108` |
| F2 | Each transition declares `guestEmail: {event, when: 'always'\|'if_notify'} \| null`: confirm and decline `always`, cancel `if_notify`, seated/no_show/corrections `null`. `ReservationEffects.afterTransition/afterCreate` run inside the transaction; every input already carries `notifyGuest`. | `lib/reservations/lifecycle.ts:47,54-66`; `lib/server/booking/reservations.ts:47-58,166,291` |
| F3 | `appOrigin()` falls back silently to `http://localhost:3000`. `deliverInvite` wraps the send and its bookkeeping UPDATE in one `try`. Template defaults `expiresInMinutes = 60`, `expiresInDays = 7` are literals. | `lib/server/email/auth-emails.ts:18-20`; `lib/server/auth/staff.ts:49-72`; `templates/password-reset.tsx:13`, `staff-invitation.tsx:16` |
| F4 | The guest email check is `/^\S+@\S+\.\S+$/` on both sides (server after `max(254, {abort:true})`). It accepts `a@b@c.vn`, which the outbox's address CHECK refuses. | `lib/booking.ts:38`; `lib/server/booking/input.ts` at `bf20f55` |
| F5 | `resolveStrings` order: row in the locale → the registry's own text for that locale (`vi` only, `email.*`/`legal.*` only) → row in the default → registry EN. `ADMIN_SCREENS` already has `legal` and `emails`. Spec: guests get email "bằng ngôn ngữ khách dùng khi đặt bàn". | `lib/i18n/resolve.ts`; `lib/i18n/registry.ts:8-24,221-225`; spec §1 goal 3, §3 row Email |
| F6 | The proxy matcher would 307 BotID's `/149e9513-…` paths to `/en/…` (they start with digits, not a locale shape, and contain no dot). | `proxy.ts:16-19` |
| F7 | `after()` works in Server Functions, runs up to the route's `maxDuration`, runs even on throw/redirect, and uses `waitUntil` on Vercel. A GET handler that reads `request.headers` is dynamic. `maxDuration` is a segment option. `cookies().set` only in a Server Function or Route Handler. | `04-functions/after.md:8,50,54,247-260`; `01-getting-started/15-route-handlers.md:124`; `02-route-segment-config/index.md:13`; `04-functions/cookies.md:6,74,81-87` (all re-read in `p5-outbox/node_modules/next/dist/docs`) |
| F8 | Vercel Functions: 300 s default on every plan, 800 s max on Pro. Crons are declared under `crons` in `vercel.json`; a cron call carries `Authorization: Bearer $CRON_SECRET`. `vercel.ts` is now recommended, but the Vercel plugin's own example is `export const config: VercelConfig = {…}`, exactly the form outbox-core proved compiles to `{"config":{…}}` (the cron would not register). There is no `vercel.json` at HEAD. | Vercel functions skill (plugin 0.50.0); `outbox-core.md` §1.15 |
| F9 | `nodemailer@10.0.13`'s exports map lists `./lib/smtp-transport` and has no `types` condition; TypeScript picks the sibling `.d.ts`. `@types/smtp-server` has `/// <reference types="nodemailer" />`, so it loads `@types/nodemailer@8` as a types package; typecheck stayed green in `p5-outbox`. | `p5-outbox/node_modules/nodemailer/package.json`; `@types/smtp-server/index.d.ts:2` |
| F10 | CI generates `BETTER_AUTH_SECRET` into `$GITHUB_ENV` and runs E2E with `BETTER_AUTH_URL=http://localhost:3100`, `EMAIL_DELIVERY=log`, `EMAIL_LOG_FILE`. No `CRON_SECRET`. Playwright's `webServer` inherits the env. | `.github/workflows/ci.yml:52-59`; `playwright.config.ts:78-86` |
| F11 | 12 seeded restaurants; `cafe-indochine` is the only one not in phase 4's E2E data map. | `002_seed_restaurants.sql`; phase-4 plan, "Bản đồ dữ liệu E2E" |
| F12 | The pool has `max: 5`; the booking-day lock uses `lock_timeout 5s`; `pg_advisory_xact_lock` has one call site. | `db/client.ts`; `lib/server/booking/lock.ts` |
| F13 | F2's done-screen text: `booking.done_requested` = "Your table request at {restaurant} has been received. Our team will contact you shortly to confirm."; `booking.done_confirmed` = "Your table at {restaurant} is confirmed. We look forward to welcoming you." Their contexts say the emails must match. | `registry.ts:183-197` at `bf20f55` |

**Conflicts between the spikes, and the decision for each**

| # | Conflict | Decision | Evidence |
|---|---|---|---|
| C1 | **Three migration 007 files:** outbox-core `007_email_outbox.sql`, templates stub `007_email.sql`, guard `007_guest_guard.sql`. | One file, **`007_email_and_consent.sql`**, outbox-core's as the base, plus the guard's consent block. `staff.test`, `created_by` and `email_outbox_test_only_unbooked` go (R9); `reservation_id` is NOT NULL. Exact names in §4.5. | outbox-core migration test (10); guard consent CHECK NULL trap (its error 1) |
| C2 | **SMTP module.** outbox-core: `smtp.ts` + `send.ts`, no-auth relays allowed, DNS timeout 5 s, code `rejected`, `provider_id` = the SMTP reply. Templates: `smtpOptionsFromEnv`, DNS 10 s, `provider_error` + a `permanent` flag, `replyTo`. | outbox-core's modules, plus `replyTo?: string` on `SendEmailInput` and `TransportMessage` from the templates spike. | outbox-core `smtp.test.ts` (9 wire tests), `email.test.ts` (21); templates Reply-To test |
| C3 | **Test sink and its types.** outbox-core: richer sink (`secure`, `noStartTls`, `failData`, `holdDataMs`, `seen`, silent server), `@types/smtp-server`. Templates: `mailparser` + a hand-written `test/types/smtp-sink-modules.d.ts`, believing `@types/nodemailer` would shadow nodemailer's own types. | outbox-core's sink and `@types/smtp-server@3.5.13`; no `mailparser`, no local d.ts. Templates' wire assertions (Vietnamese subject, multipart/alternative, Reply-To, Message-ID) are rewritten against the raw message with the sink's header decoder; body content is asserted at render level. | F9; outbox-core typecheck green with `@types/nodemailer` present |
| C4 | **Import guard.** Templates: only `lib/server/email/` may import nodemailer, resend **or smtp-server** (wrong: the sink lives in `test/helpers`). outbox-core: nodemailer only in `lib/server/email/`, smtp-server only under `test/`, resend nowhere. | outbox-core's `mail-transport.guard.test.ts`. | — |
| C5 | **Env helper:** `outboxEnv()` vs `emailEnv()`. | One `outboxEnv(env = process.env)` in `lib/server/email/env.ts`, used by the queue, the drain, the log and the overview. | — |
| C6 | **Event names and skip rules.** Templates' `lib/email/events.ts` (client-safe, labels, `maskEmail`) has `guest.confirmed` sendable while `confirmed` **or `seated`** (walk-ins). outbox-core: `confirmed` only. | `lib/email/events.ts` from templates holds names, labels, statuses (plus `sending`, "Đang gửi") and `EVENT_STATUSES`, with outbox-core's rule: `guest.confirmed` only while `confirmed` (R7, R8). | spec §10.3; R8 |
| C7 | **Recipient predicate.** outbox-core: `reachesSql` inside `outbox.ts`, one `INSERT … SELECT` with the fallback, in the transaction. Templates: `reaches()` in `recipients.ts`, a `staffRecipients()` reader. | One `reachesSql` in `lib/server/email/recipients.ts`, used by `queueStaffNew` (outbox-core's single statement), `restaurantsWithoutRecipient` and `emailOverview`. `staffRecipients()` is not built. A test holds queue and overview to the same answer. | outbox-core M7/M8 |
| C8 | **Render seam.** outbox-core's drain calls a placeholder `renderBookingEmail(event, locale, data)` after its own `loadBooking`. Templates' `renderBookingEmail(db, {event, reservationId, locale})` loads data itself. | The drain loads **once** with templates' `loadBookingEmailData` (extended with `anonymized`), checks staleness, then `resolveEmailLocale` → `loadEmailStrings` → `buildBookingEmail` → `renderEmail`. Until T5 a placeholder body sits behind the same call (T4). | templates `render.test.ts` (24) |
| C9 | **Requeue.** outbox-core `requeueFailed` (failed only, attempts 0). Templates `requeueEmail` (failed → attempts 0; waiting queued → due now; conditions on the locked row, after a race it found). | Templates' `requeueEmail`, on outbox-core's statuses: `failed` → `queued`, attempts 0; `queued` → due now; `sending`, `sent`, `skipped` → `not_resendable`. Plus an `audit_log` row in the same transaction (R2) and `drainAfterCommit([id])`; no `refresh()`. | templates error 11 |
| C10 | **"Gửi email thử".** outbox-core: a `staff.test` outbox row, drained at once. Templates: a direct, awaited send through the same gate. | Direct send (R9). | spec §10.4; templates `test-email.ts` |
| C11 | **Overview reads.** outbox-core `emailOverview()`; templates `countFailedEmails` + `restaurantsWithoutRecipient`. | One `emailOverview(db, env) → { failed, unrouted: {id, name}[] }`. | — |
| C12 | **Message-ID.** Templates `<outbox-{id}@domain>`; outbox-core `<outbox-{id}.{12 hex}@domain>`, persisted at the first claim. | outbox-core's (R5). | outbox-core retry test: 7 wire attempts, one Message-ID |
| C13 | **Which SMTP failures are final.** outbox-core: only 5xx at `RCPT TO` (`rejected`). Templates: 5xx at envelope **or DATA**. | outbox-core's (R6). A provider can answer a passing condition with a 5xx at DATA (Microsoft 365 reports a sending-quota overrun as `554 5.2.0 … SubmissionQuotaExceededException`), which must be retried. | outbox-core error strings §6 |
| C14 | **Found while reading `drain.ts`:** one `try` wraps load, render, send and the `sent` mark, so a DB error on the `sent` UPDATE after a successful send runs the failure mark and schedules a re-send. | T4 splits it: a failure after the send has returned is not a send failure. Retry the `sent` mark once; if it still fails, log `code=mark_failed` and leave the row `sending` (the lease expires, the cron re-sends with the same Message-ID). A test simulates the mark failing once. | `p5-outbox/lib/server/email/drain.ts` `deliver()` |
| C15 | **`after()` scheduling in bulk cancel.** outbox-core drains after the loop; a throw mid-loop leaves committed cancellations' emails for the cron. | `drainAfterCommit(effects.queued)` in a `finally`, guarded by `queued.length > 0` (R20). | outbox-core risk 12 |
| C16 | **E2E specs.** `booking-email.spec.ts` (outbox), `admin-emails.spec.ts` (templates), `guest-guard.spec.ts` and `botid.spec.ts` (guard). | All kept, with the data map of §4.11. `booking-email` moves off `taya-house` (phase 4's `booking-v2` books its last open day) to `cafe-indochine`. | F11 |

## 1. Verified decisions

Each deliverable and acceptance criterion of §14.1 row 5, the approach, where it was verified, and the test that pins it.

| # | Item | Approach | Source | Pinned by |
|---|---|---|---|---|
| D1 | **Outbox** | Rows written on the transaction's client: `queueWebBookingEmails` in `create.ts` after the `created` event (`RETURNING id`), and `outboxEffects()` through `ReservationEffects` for transitions and staff create. One row per recipient; `idempotency_key` = generated `'outbox:' \|\| id` STORED UNIQUE. | outbox-core §1.3–1.4 | `email-outbox.test.ts`: "hook failure rolls back booking and rows", recipients union/dedupe, transitions confirm/decline/cancel±notify, staff create phone/unticked/walk-in |
| D2 | **Delivery protocol** | Claim one row (`FOR UPDATE SKIP LOCKED`, `sending`, attempts+1, lease 120 s, Message-ID fixed), re-read the booking, send with no client held, fenced marks. At least once (R1). | outbox-core §1.6 | concurrent drains (12 rows → 12 sends), crash (lease blocks, then 2nd copy same Message-ID), fencing (`lost:1`), reaping; mutations M1, M2, M4 |
| D3 | **Send after commit** | `drainAfterCommit(ids)` = `after(() => drainQuietly({ids, limit 10, budget 25 s}))`, only after a successful commit, before `redirect()`. | outbox-core §1.13; F7 | `submit-reservation.test.ts` (after got exactly one task; running it marks rows `sent`; a refused booking schedules none); E2E `booking-email` (rows `sent` after the action answered) |
| D4 | **Cron** | `GET /api/cron/outbox`, `maxDuration 300`, budget 240 s / 500 rows, `no-store`; 401 unless `Authorization: Bearer $CRON_SECRET` (≥16 chars, constant-time). `vercel.json` `*/5 * * * *`. | outbox-core §1.14–1.15; F8 | `cron-outbox.test.ts` (401 ×4 with nothing sent; 200 drains only due rows of its env); E2E 401/200; build manifest `maxDuration 300`; mutation M5 |
| D5 | **Retry** | Waits 1/5/15/60/360/720 min; 7 attempts ≈ 19.4 h; then `failed`, shown on the overview. RCPT 5xx fails at once (R6). | outbox-core §1.8 | retry-ladder test (observed waits `[1,5,15,60,360,720]`, 7 wire attempts); "550 fails at once" |
| D6 | **Templates EN/VI from the registry** | `email.<event>.<field>` + `email.common.*`, EN and VI, rendered at send time from the reservation; React Email. | templates §3–§4 | `render.test.ts` (10 event×locale renders, text table, guest/staff split, reasons, escaping, F2 wording); `email-screens.test.ts` (overrides, no internal notes) |
| D7 | **Recipients** | `notification_recipients`; restaurant ∪ destination ∪ all; `DISTINCT ON (lower(email))`, most specific scope wins; fallback to `site_settings.email` (R3, R4). Admin screen `/admin/settings/notifications`. | outbox-core §1.3; templates §6, §8 | recipient tests in both files; mutations M7 (no dedupe), M8 (no fallback); CRUD/audit/conflict tests |
| D8 | **"Gửi email thử"** | Direct send of a sample booking's email through the same gate, awaited, with a Vietnamese hint on failure (R9). | templates §8 | `email-screens.test.ts` (live via sink, redirect, EAUTH); `admin-emails` E2E (lands in `EMAIL_LOG_FILE`) |
| D9 | **Email log and "Gửi lại"** | `/admin/reservations/emails`: keyset, tabs, env-scoped, guest addresses masked; "Gửi lại" = `requeueEmail` + audit + `after()`. Detail page lists the booking's emails. | templates §7 | log paging/env/tabs, requeue semantics; `admin-emails` E2E (failed → sent via `after()`, refused for a sent row) |
| D10 | **Environment gate** | `EMAIL_DELIVERY` log (default) / redirect / live for every email; log on a Vercel deployment throws `not_delivered`; `email_outbox.env` from `VERCEL_ENV`; a sender drains only its env. | phase 3; outbox-core §1.9 | `email.test.ts` modes; env-isolation test; log-on-Preview → retry; mutation M5 |
| D11 | **SMTP transport** (user decision) | nodemailer, non-pooled, `requireTLS` on 587, TLS ≥1.2, per-step timeouts + 30 s cap, settings read at send time. | outbox-core §2 | `smtp.test.ts` (587 STARTTLS+AUTH, 465, no-STARTTLS refused, EAUTH, 550/451, silent server, DATA held); mutation M6 |
| D12 | **Privacy page** | `/[lang]/privacy` (prerendered, `content:legal`), `legal.*` keys, footer link. | guard §4 | `guest-guard` E2E footer test; `check-prerender` `/en/privacy`; `legal.test.ts` hash pin |
| D13 | **Consent checkbox** | `consent: z.literal(true)` → `consent_required`; drawer checkbox with notice and link; `reservations.consent_version` + `consented_at` (R17). | guard §4 | `submit-reservation` consent and CHECK tests; `guest-guard` E2E (unticked → no POST) |
| D14 | **Honeypot** | Off-screen `website` field sent as `honeypot`; any non-empty value → visible `bot_blocked` (R15). | guard §2 | `guest-guard` E2E (not in the a11y tree; filled → alert, 0 rows) |
| D15 | **Per-phone limit** | 3 requested/confirmed web bookings per `phone_e164` per `reserved_on`, under a guest-phone advisory lock taken before the day lock (R14). | guard §3 | step-5 block (6 restaurants at once → exactly 3); lock removed → 5 of 6 succeed (red 3/3) |
| D16 | **BotID** | `withBotId`, `initBotId({protect:[{path:'/*',method:'POST'}]})` on guest pages of deployments, `checkBotId()` in step 1 on deployments only, fail open (R16). | guard §1 | `bot.test.ts` (9), `botid.test.ts` (13, the real wrapper), integration `BOTID_DEV_BYPASS=BAD-BOT` → `bot_blocked`, 0 rows; opt-in `botid.spec.ts` |
| D17 | **SEC-2** (pulled into phase 5 by the phase-4 ruling) | Search posts to `searchReservations`; `q` lives in a 30-min httpOnly cookie; URL carries `?tim=<id>`; proxy drops `q` from `next` (R18). | guard §5 | `inbox-search.test.ts`; `admin-reservations` search E2E (no phone in URL, httpOnly, second tab expires the first); `proxy.test.ts` |
| D18 | **Overview** | "N email lỗi" (env-scoped) and "Nhà hàng chưa có người nhận thông báo" (R21). | templates §7 | `email-screens` overview tests; `admin-emails` E2E |
| **A1** | **New booking emails staff** | Web submit queues `staff.new` in the transaction; `after()` sends it. | outbox-core E2E evidence | E2E `booking-email` test 1 (log line `staff.new`, row `sent`). **Mutation (T13):** `queueWebBookingEmails` skips `queueStaffNew` → red |
| **A2** | **Confirming emails the guest** | `requested → confirmed` declares `guestEmail always`; `outboxEffects.afterTransition` queues `guest.confirmed`. | F2; outbox-core | E2E `booking-email` test 2. **Mutation:** `afterTransition` returns early → red |
| **A3** | **A failed email is retried** | Retry ladder; the cron and `after()` drain due rows; "Gửi lại" for exhausted rows. | outbox-core §1.8 | Integration: retry ladder over the sink. E2E (T13): a row seeded `queued`, attempts 1, `last_error 'provider_error: …'`, due now → `GET /api/cron/outbox` with the secret → `sent`, attempts 2; plus `admin-emails` "Gửi lại". **Mutation:** the failure mark sets `failed` at once → integration red; claim ignores `attempts > 0` rows → E2E red |
| **A4** | **No recipients → general email** | `queueStaffNew` falls back to `site_settings.email` (`fallback=true`); overview names the restaurant. | outbox-core; templates | E2E `booking-email` test 1 (`fb@furamavietnam.com`, `fallback=true`); `admin-emails` overview. **Mutation:** drop the `UNION ALL … site_settings` branch → red |
| **A5** | **Bots are blocked** | Honeypot, BotID, per-phone limit. | guard | E2E honeypot (`guest-guard`), integration BAD-BOT, per-phone E2E and race test. **Mutations:** drop `honeypotFilled` → E2E red; drop `isBotRequest` → integration red; drop `lockGuestPhoneDay` → race red |
| §13 | **Cron 401 without the secret** (spec §13 E2E list) | — | outbox-core | E2E 401 ×2 / 200. **Mutation:** `cronAuthorized` returns true → red |

## 2. Spec deviations that need a ruling

### 2.0 Spec amendment: SMTP instead of Resend (the controller applies it)

Replace in `docs/superpowers/specs/2026-10-01-admin-cms-design.md`:
- **§4 tree:** `email/ outbox, template React Email, gửi qua Resend` → `… gửi qua SMTP (nodemailer)`; `├── Resend email (gửi từ subdomain của furamavietnam.com)` → `├── Máy chủ SMTP email (tài khoản SMTP; tên miền gửi có SPF, DKIM, DMARC)`.
- **§4 library table:** `resend`, `react-email` ^6.31, ^6.11 → `nodemailer`, `react-email` ^10.0, ^6.11, "Gửi email qua SMTP (587 STARTTLS hoặc 465 TLS). Import component từ `'react-email'`…"; add `smtp-server` (dev, máy SMTP giả trong test).
- **§10.4 first paragraph:** "**SMTP.** Gửi qua máy chủ SMTP truyền thống bằng nodemailer, cổng 587 (bắt buộc STARTTLS) hoặc 465 (TLS), từ `EMAIL_FROM`. Thông số nằm trong `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, đọc lúc gửi."
- **§10.4 Outbox, idempotency bullet:** "Idempotency key là `outbox:{id}` (UNIQUE). SMTP không có idempotency key, nên email được gửi **ít nhất một lần**: bộ gửi giữ hàng bằng lease trước khi gửi và đánh dấu `sent` ngay sau đó; mọi lần gửi của một hàng dùng cùng Message-ID `<outbox-{id}.{12 ký tự hex}@{tên miền gửi}>`. Nếu tiến trình chết giữa lúc máy chủ SMTP nhận thư và lúc đánh dấu, người nhận có thể nhận hai bản giống hệt."
- **§10.4 retry bullet:** drop "là thời gian Resend còn giữ key"; say "Mọi lần gửi nằm trong khoảng 19,4 giờ."
- **§10.4 gate bullet:** "Hai loại email này đi thẳng qua SMTP, không qua outbox."
- **§13 integration row:** "outbox idempotent" → "outbox gửi ít nhất một lần và không gửi trùng khi hai bộ gửi chạy song song".
- **§14.1 row 3:** keep as history, add "(từ đợt 5: SMTP)".
- **§15:** item 2 "Nâng Vercel lên Pro": done (2026-10-02). Items 4–5 become: "4. Cung cấp tài khoản SMTP (host, cổng 587 hoặc 465, tên đăng nhập, mật khẩu hoặc app password) và địa chỉ gửi `EMAIL_FROM` mà tài khoản đó được phép gửi. 5. IT Furama cấu hình SPF, DKIM, DMARC cho tên miền gửi tại nhà cung cấp mail (DMARC bắt đầu `p=none`; kiểm trước xem domain gốc đã có DMARC chưa)."
- **§16:** the row "Resend qua Marketplace…" → "Vercel Functions chưa chắc ra được cổng 587/465 của nhà cung cấp SMTP | Kiểm bằng 'Gửi email thử' ở preview đầu tiên; dự phòng: đổi 587↔465 hoặc đổi nhà cung cấp".
- **§5.2:** `site_settings` row: "đợt 5 tạo sớm bảng một hàng với cột `email` (R3); đợt 6 thêm các cột còn lại bằng `ADD COLUMN IF NOT EXISTS`."

**Cost if wrong:** none for the code; the spec would otherwise contradict the build.

### 2.1 Rulings (proposed; each says what it costs if wrong)

1. **R1. SMTP, delivered at least once.** nodemailer replaces Resend for all email. No idempotency key exists, so the protocol is claim → lease → send → fenced mark, with a persisted Message-ID. Duplicate windows: the function dies after the server's 250 and before the mark; the 30 s cap fires while the server still accepts DATA (proved against the sink); the `sent` mark fails (C14 narrows this one). **If wrong** (exactly-once wanted): only a provider with an idempotency API can give it; the outbox is unchanged, the transport swaps back.
2. **R2. Email history lives only in `email_outbox`.** `reservation_events`' CHECK stays as in 006; sends never reach `/admin/audit` through `audit_feed`. The detail page lists `email_outbox` rows beside the timeline. "Gửi lại" writes one `audit_log` row (`action 'update'`, `entity_type 'email_outbox'`, `entity_id` = outbox id, `before {status, attempts}`, `after {status:'queued'}`, no address), label "Email" in `audit-labels.ts`. Phase 4's deferred "audit-label guard reads 006's CHECK" and "label guest/system email events" become moot. **If wrong:** a later migration replaces the CHECK and backfills from `email_outbox`; the guard then reads the live constraint.
3. **R3. The general-email store is `site_settings`, created early in 007** with `email` only, seeded `fb@furamavietnam.com` (`CONTACT.email`). Phase 6 must `ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS …`, never `CREATE TABLE`. Editing "Hộp thư chung" will also change the footer email from phase 6/7; the screen says so. **If wrong:** phase 6 renames or moves one column.
4. **R4. Recipients.** Scopes restaurant ∪ destination (`restaurants.destination`) ∪ all; active rows whose `events` contain `staff.new`; `DISTINCT ON (lower(email))`, the most specific scope's spelling and locale win; `events` CHECK `<@ ARRAY['staff.new']`; locale default `vi`; the fallback row uses `vi`. **`staff.new` is queued only for web bookings** (staff do not need to tell themselves); its intro says "đã tự xác nhận" when auto-confirmed. **If wrong:** one call in `outboxEffects.afterCreate`.
5. **R5. Message-ID** `<outbox-{id}.{12 hex}@{EMAIL_FROM domain}>`, fixed at the first claim that knows the domain and reused by every retry and "Gửi lại". The random part keeps Preview branches and dev DBs from minting an ID a mailbox has already seen (Gmail may drop the second). Invite/reset: `<invite-{id}-{sha16}@domain>` / `<reset-…>`, never the token. **If wrong:** cosmetic; a header format.
6. **R6. Claim and retry semantics.** Attempts count at claim (a crashed send uses one); lease 120 s; a `sending` row whose lease expired on attempt 7 is reaped to `failed` (`lease_expired`); 5xx at `RCPT TO` → `rejected`, failed at once; everything else (auth, TLS, 4xx, DATA 5xx such as a provider quota, timeouts, config, `not_delivered`) retried on the ladder. "Gửi lại" on `failed` resets attempts to 0 (a fresh ≈19.4 h schedule). **If wrong:** a spam-rejected message is retried 6 more times over 19 h (DATA 5xx); flip one condition.
7. **R7. Skip-on-mismatch.** Sent only while the booking is: `staff.new` requested/confirmed/seated; `guest.ack` requested; `guest.confirmed` confirmed; `guest.declined` declined; `guest.cancelled` cancelled. Also skipped: booking gone or anonymised; guest address changed since queueing. A corrected address is not emailed automatically, and "Gửi lại" refuses skipped rows, so staff confirm by phone. `last_error` says why (`skipped: the booking is now cancelled`). **If wrong:** edit `EVENT_STATUSES`, or let "Gửi lại" requeue a skipped guest row to the current address.
8. **R8. Staff-side email choices** (spec §10.3 wording, made concrete):
   - New phone booking: "Gửi email xác nhận" shown, **default on**; queues `guest.confirmed` when ticked and the booking has an email.
   - New walk-in: the checkbox is hidden; a walk-in never gets `guest.confirmed` (deviation: the spec row allows it when ticked; the guest is already at the table).
   - Cancel (single and bulk from a closure's affected list): "Báo khách qua email" **default on**.
   - Decline: always emails (spec), with the reason.
   - When an email will carry the reason, the reason field says "Lý do này sẽ được gửi cho khách."
   - **If wrong:** defaults are one attribute each; walk-in email is one condition plus `EVENT_STATUSES['guest.confirmed']` gaining `seated`.
9. **R9. "Gửi email thử" sends directly**, not through the outbox: the sample booking (`FC-0000TEST`, no guest data) in a chosen template and language, through the same gate and transport, awaited; the Admin sees "Đã gửi (chế độ live|redirect|log) tới …" or a Vietnamese hint (`email_failed`). Nothing is stored; a log line carries only the code. The spec lists it as a sender trigger; a direct send tests what matters on a deployment (SMTP reach, credentials, DNS alignment, rendering) without a test row on the failed count or a 19 h retry. **If wrong:** add `staff.test` back (nullable `reservation_id`, LEFT JOINs in the log, overview exclusion) in a follow-up migration.
10. **R10. Guest email language.** `reservations.locale` when that locale is enabled **or** the registry carries its own text for every key the email reads (true for `vi`); else the default locale (`en`). So a Vietnamese phone booking gets Vietnamese email at launch A, as spec §1/§3 say, while a locale with no copy never gets mixed English text with foreign dates. Staff emails always use the recipient's locale. (Templates spike proposed "enabled only"; phase-4 risk 21 left this to phase 5.) **If wrong:** one predicate in `resolveEmailLocale`.
11. **R11. Reply-To:** `staff.new` → the guest's email (staff can reply to the guest); guest emails → `site_settings.email`. **If wrong:** two lines; confirm with the restaurant team.
12. **R12. Email log privacy:** the list masks guest addresses (`l•••@gmail.com`), staff addresses in full; the booking page shows the full address (it already shows the guest); `last_error` redacted at write and again at display; the URL holds only `tab` and `sau`. **If wrong:** cosmetic.
13. **R13. One `@` in a guest email.** Tighten the guest pattern to `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` on both sides, still after the aborting `max(254)` (F1 of the fix wave). Belt and braces: the queue inserts a guest row only when the address passes `^[^@[:space:]]+@[^@[:space:]]+$`, so an odd stored address never aborts a booking. **If wrong:** a guest with a quoted local part containing `@` (practically none) gets `invalid_email`.
14. **R14. Per-phone limit:** at most `PHONE_DAY_LIMIT = 3` **requested or confirmed web** bookings for one `phone_e164` on one `reserved_on`, across restaurants. Checked inside the booking transaction under `lockGuestPhoneDay` (key `guest-phone:<e164>:<date>`, 5 s timeout) taken **before** `lockBookingDay`, so `too_many_requests` wins over the rule codes and a burst from one number waits on its own key. Message gives the destination phone. Alternative: 3 created per Da Nang day (stronger against one prankster, blocks a family booking 4 dinners at once). **If wrong:** one query and one key.
15. **R15. Honeypot:** a visible `bot_blocked` ("We could not accept this request online. Please call us on {phone} to book."), never a fake success: an autofill false positive must not look like a booking. Any value other than `undefined`/`null`/`''` counts. **If wrong:** return a fake `ok` for `by: 'honeypot'` only.
16. **R16. BotID on the Server Action.** Client: `initBotId` from `instrumentation-client.ts` only when `NEXT_PUBLIC_VERCEL_ENV ∈ {production, preview}` and the path is not `/admin`; it patches `fetch`, which Next's action client calls at call time. Server: `checkBotId()` only when `VERCEL_ENV ∈ {production, preview}`; **verified bots are refused**; **errors fail open** (logged `[botid] check failed`); off Vercel only `BOTID_DEV_BYPASS=BAD-BOT` turns it on (tests). No CI job for the opt-in `botid.spec.ts`; integration + the real-wrapper unit test cover CI. Deep Analysis is the user's choice. **If wrong:** fail closed is one `return true`; allowing a verified-bot category is one condition.
17. **R17. Consent record and policy copy:** `reservations.consent_version` (= `PRIVACY_POLICY_VERSION '2026-10-02'`) + `consented_at`, pair CHECK, kept by the anonymiser. Notice and checkbox keys `booking.privacy_notice`, `booking.consent` (screen `legal`, `booking.` prefix so they reach the client); `legal.link` joins `ClientKey`; page keys `legal.*`. **EN only** until a lawyer-reviewed VI text arrives (the registry allows VI for `legal.*`). The version is pinned by a hash test of the EN text. The footer link is hidden in the visual specs by `e2e/visual-added.css` (never `--update-snapshots`). **If wrong:** re-take the 8 baselines once with a reviewed diff.
18. **R18. SEC-2 now:** `searchReservations` (`reservations:read`) stores `q` in cookie `fc_inbox_search` (httpOnly, `sameSite strict`, path `/admin/reservations`, 30 min, `secure` unless `BETTER_AUTH_URL` is http) and redirects to `?tim=<8 hex>`; pager `?tim=&sau=`; another tab's search expires the first; proxy drops `q` from `next`. **If wrong:** the cookie still holds PII on the staff browser for 30 min; add a clear action.
19. **R19. Cron config:** `vercel.json` (no dependency, JSON schema), not `vercel.ts` (F8: `@vercel/config` 0.7.2 adds zod 3, 3 high audit findings, and the documented `export const config` form silently drops the cron). `GET` only; `CRON_SECRET` shorter than 16 characters → every call 401. **If wrong:** move to `vercel.ts` with `export default`.
20. **R20. What `after()` drains:** the ids it queued, then other due rows of its env, at most 10 rows / 25 s; scheduled only on a successful commit; bulk cancel schedules it in a `finally` when anything was queued. "Gửi lại" drains its one id. **If wrong:** budgets are constants.
21. **R21. Overview:** "N email lỗi" counts `failed` rows of the current env; "Nhà hàng chưa có người nhận thông báo" lists `booking_enabled` restaurants no active recipient reaches (they still email the shared inbox). **If wrong:** one WHERE clause.
22. **R22. Preview and staff mail** (phase-3 ledger risk 1): Preview uses `EMAIL_DELIVERY=redirect` to an inbox only the Admin reads. Reset links of forked staff rows land there, but a reset on Preview changes only the Preview branch's copy, never production. **If wrong:** set Preview to `log` and accept that invites fail there (`not_delivered`).
23. **R23. `appOrigin()` fails closed:** it throws a new `EmailSendError('missing_app_url')` when `BETTER_AUTH_URL` is unset and the mode is live/redirect or `VERCEL_ENV` is production/preview; log mode off Vercel keeps the localhost fallback for dev and tests. The staff link in `staff.new`, invite and reset all use it. **If wrong:** one condition.

## 3. Tasks in execution order (all on `main`, one commit per task, each ends green)

Every task: RED first (the new test fails for the stated reason), then code, then the gate of §4.1. Concurrency and guard tests are run once more with their guard removed. Counts are re-measured on the post-wave HEAD.

**T1. Migration 007 and the event names.**
- `db/migrations/007_email_and_consent.sql` exactly as §4.5: `site_settings` (email only, seeded), `notification_recipients`, `email_outbox` (5 events, `reservation_id NOT NULL`, generated STORED key, CHECKs, 4 indexes), `reservations.consent_version/consented_at` + `reservations_consent_check`. `reservation_events` untouched.
- `lib/email/events.ts` (client-safe): `EMAIL_EVENTS`, `GUEST_EMAIL_EVENTS`, `STAFF_EMAIL_EVENTS`, `audienceOf`, `EMAIL_EVENT_LABELS`, `EMAIL_STATUSES` (+`sending`), labels, `maskEmail`, `EVENT_STATUSES` (R7).
- `test/integration/migration-007.test.ts` (`TEST_DB_TAG` → `furama_cuisine_migrate007_<tag>_test`): applies on a DB at 006 with data; event CHECK equals `EMAIL_EVENTS`; 006's CHECK unchanged; key `outbox:<id>` STORED + UNIQUE + "can only be updated to DEFAULT"; each CHECK and FK; cascade/SET NULL; case-insensitive recipient uniqueness; single `site_settings` row; consent pair CHECK incl. the NULL trap; re-run safe; indexes.
- Source: outbox-core T1 + guard G2's SQL. Phase-6 note in the SQL header (R3).

**T2. SMTP replaces Resend for all email, with phase 3's deferred email items.**
- `types.ts` (codes `missing_smtp_config`, `rejected`, `missing_app_url`; `redactEmails`; `MailTransport`; `replyTo`), `smtp.ts`, `send.ts` (`openMailer`, `createEmailSender`, `messageIdFor`, `senderDomain`, 30 s cap, classification), `auth-emails.ts` comments + `appOrigin()` fail-closed (R23).
- `staff.ts` `deliverInvite`: send in one `try`, bookkeeping UPDATE after it, so a DB error after a successful send is not "email failed" (phase-3 item).
- Template expiry props passed from the real constants (reset token seconds, invite days) instead of literals (phase-3 item).
- `lib/admin/auth-errors.ts` map + test. No `as unknown as` cast for the transport (phase-3 item: the Resend cast goes with Resend).
- `package.json`: −`resend`; +`nodemailer@^10.0.13`; dev +`smtp-server@^3.19.16`, `@types/smtp-server@^3.5.13`.
- Tests: `test/helpers/smtp-sink.ts` (outbox-core's), `smtp.test.ts` (9 + templates' Vietnamese subject / multipart / Reply-To wire checks against raw headers), rewritten `email.test.ts`, `mail-transport.guard.test.ts` replacing `resend-import.guard.test.ts`; invite/reset tests green.
- README env table: `SMTP_*`, `EMAIL_FROM`, `CRON_SECRET` placeholder row; `RESEND_API_KEY` removed; "Email (SMTP)" section.

**T3. Outbox rows in the change's transaction, and the staff checkboxes.**
- `lib/server/email/env.ts` (`outboxEnv`), `recipients.ts` (`reachesSql` only), `outbox.ts` (`queueGuestEmail`, `queueStaffNew`, `queueWebBookingEmails`, `outboxEffects`).
- `create.ts`: `created` event `RETURNING id::text`, queue, `CreateOutcome.ok.outboxIds`.
- Admin actions pass `notifyGuest` and `effects: outboxEffects()` (no drain yet). `booking-schemas.ts` `Checkbox`; `TransitionPanel` (cancel: "Báo khách qua email", default on; reason hint), `AffectedList` (bulk, default on), `NewReservationForm` ("Gửi email xác nhận", default on, hidden for walk-in) per R8, re-based on F9's `NewReservationForm`/`TargetPicker`.
- Tests: the queueing half of `email-outbox.test.ts` (union/dedupe/inactive/fallback/ack on-off/auto-confirm/no address/`a@home@example.com` still books/duplicate queues nothing/transitions/staff create/rollback/env).
- Rows stay `queued` until T4; nothing sends.

**T4. The drain and its triggers.**
- `drain.ts` (outbox-core's, with C14's split mark), `after-commit.ts`, `lib/server/cron.ts`, `app/api/cron/outbox/route.ts`, `vercel.json` (§4.6).
- `lib/server/email/booking/load.ts`: `loadBookingEmailData(db, id)` (templates' query + `anonymized`) used for staleness; a deliberately minimal renderer behind `renderOutboxEmail(db, row, data)` (subject `<event> <reference>`, plain text) that T5 replaces.
- Wiring: `submitReservation` after ok; `changeStatus`; `createReservation` before `redirect()`; `cancelReservations` in `finally` (R20).
- `scripts/check-prerender.mjs`: `/api/cron/outbox` must not be prerendered.
- CI: `ci.yml` generates `CRON_SECRET` like `BETTER_AUTH_SECRET`; the E2E prefix gains it (§4.1).
- Tests: drain half of `email-outbox.test.ts` (Message-ID on the wire = stored; env isolation; ladder; 550; skip; 2 drains; crash; fencing; reaping; log; Preview `not_delivered`; SMTP down keeps the booking; the `sent` mark failing once), `cron-outbox.test.ts`, the `vi.mock('next/server')` collector in `submit-reservation.test.ts`, `e2e/booking-email.spec.ts` (subjects matched by reference until T5).
- Mutations M1–M5 recorded.

**T5. Templates EN/VI from the registry.**
- Registry `email.common.*`, `email.guest.{ack,confirmed,declined,cancelled}.*`, `email.staff.new.*` (EN + VI, screen `emails`); `ack.intro`/`confirmed.intro` EN equal F13's done keys.
- `lib/server/email/booking/{format,render,sample}.ts`, `templates/booking.tsx`, `templates/layout.tsx` (`lang`, `footer`), `loadStringRows(locale, keys, db?)`, exported `groupPhoneSql`, Reply-To (R11), `resolveEmailLocale` per R10. The drain's `renderOutboxEmail` now calls `resolveEmailLocale` → `loadEmailStrings` → `buildBookingEmail` → `renderEmail`.
- Measure the react-email footprint (phase-3 deferred): `npm ls --omit=dev` for tailwind/esbuild/socket.io, and the size of the server chunk that holds the renderer; record numbers in the ledger; act only if it threatens the 250 MB function limit.
- Tests: `render.test.ts` (24, F2 test unconditional), the locale/overrides/no-notes/phone/Reply-To part of `email-screens.test.ts`; E2E subjects become exact.

**T6. Notification settings: recipients, shared inbox, "Gửi email thử".**
- `/admin/settings/notifications` (Admin): `RecipientEditor`, `DeleteRecipient`, `SharedInboxForm`, `TestEmailForm`; `settings/notifications/actions.ts` (`addRecipient`, `editRecipient`, `removeRecipient`, `saveInbox`, `sendTest`: `settings:update`, `refresh()`); `lib/admin/notification-schemas.ts`; recipients CRUD with `withTransaction` + `insertAudit` + µs token conflicts; `test-email.ts` (R9) with `emailFailureHint`; nav "Thông báo email"; audit labels; guard rows + `ADMIN_ONLY_ACTIONS`.
- Tests: CRUD/audit/conflict/duplicate-by-case; shared inbox; test email live (sink), redirect, EAUTH; guard mutation (`sendTest` → `reservations:update` goes red).

**T7. Email log, "Gửi lại", the booking's emails, overview counts.**
- `lib/server/email/outbox-log.ts` (`listEmailLog`, `listReservationEmails`, `requeueEmail` per C9 + audit row), `emailOverview` (C11); `/admin/reservations/emails` page; `reservations/emails/actions.ts#resendEmail` (`reservations:update`, `drainAfterCommit([id])`, no `refresh()`); SectionNav "Email"; detail-page section; overview items; email CSS (`.a-status--email-*`, `.a-error-text`, `.a-table-scroll`, `.a-resend`). The log lede derives its schedule text from `RETRY_DELAYS_MINUTES`.
- Tests: log paging/env/tabs, requeue semantics (incl. the race), overview; `e2e/admin-emails.spec.ts` (4).

**T8. Privacy page and legal copy.**
- `lib/legal.ts` (+hash test), registry `legal.*`, `legal.link` in `ClientKey`/`CLIENT_KEYS`, `booking.privacy_notice`, `booking.consent`; `app/(site)/[lang]/(guarded)/privacy/page.tsx`; `lib/server/content/legal.ts` (`content:legal`); `styles/legal.css`; footer link; `e2e/visual-added.css` in both visual specs; `check-prerender` `/en/privacy`.
- Tests: footer E2E; visual 8/8 at 0.

**T9. Consent, honeypot and the per-phone limit (server and drawer together).**
- `input.ts` (`consent`, `honeypot`, `honeypotFilled`, `consentVersion`; R13 pattern on both sides), `lock.ts` (`lockGuestPhoneDay`, shared helper), `create.ts` (`phoneDayFull`, consent columns), `app/actions.ts` honeypot step, `booking-errors.ts` (3 codes, `DEFAULT_PARAMS.limit`), `PHONE_DAY_LIMIT`, registry `error.*` copy.
- Drawer on top of the group-A rewrite: `Honeypot.tsx`, consent block, `SiteProvider` state/payload/`errorParams`.
- Every E2E booking ticks the box (`booking-v2` ×2, `booking-dates`, `admin-booking-settings`, `booking-acceptance` A1, `booking-email`).
- Tests: `input.test.ts`; step-5 block incl. the 6-way race (run once with the phone lock removed: red); consent CHECK; `guest-guard.spec.ts` (consent, honeypot, per-phone message). Update the phase-4 code-rule text: "one booking-day lock per transaction; a guest submit takes the guest-phone lock first".

**T10. Drawer error paths and cheap availability answers (phase-4 deferrals T5, T6).**
- 404 `restaurant_unavailable` shows its own copy with no futile Try again; Try again keeps focus inside the dialog; a double failure shows one alert; the BookingBar says something when the calendar fails.
- `/api/availability`: 400 `invalid_range` and 404 for an impossible id before any query.
- Tests: the six "no query" integration tests; drawer E2E for each path.

**T11. BotID.**
- `botid@1.5.11` (exact), `withBotId` in `next.config.ts`, proxy matcher exclusion (+`proxy-matcher.test.ts`), `lib/botid.ts`, `instrumentation-client.ts`, `lib/server/guard/bot.ts`, step 1 in `submitReservation` (honeypot, then BotID).
- Tests: `bot.test.ts`, `botid.test.ts` (real wrapper; naive `/api/*` protect list → 4 red), integration BAD-BOT, opt-in `e2e/botid.spec.ts` run once on its own server.

**T12. SEC-2: the inbox search leaves the URL.**
- `lib/server/booking/inbox-search.ts` (+test), `searchReservations`, inbox page, guard row, proxy drops `q` (+`proxy.test.ts`).
- Tests: the `admin-reservations` search E2E, re-based on F18 (re-runnable spec).

**T13. Acceptance, mutation runs, README runbook.**
- `e2e/booking-email.spec.ts` grows to the acceptance set: A1, A2, A3 (seeded due retry drained by the cron; "Gửi lại" stays in `admin-emails`), A4 (fallback + overview), cron 401/200; A5 lives in `guest-guard` + integration.
- Mutation runs, one build each, each must turn exactly its test red: A1 drop `queueStaffNew`; A2 `afterTransition` returns early; A3 failure mark → `failed` at once (integration) and claim skipping retried rows (E2E); A4 drop the fallback branch; A5 drop `honeypotFilled` / `isBotRequest` (integration) / `lockGuestPhoneDay` (race); cron `cronAuthorized` → true.
- README: env table (§4.6), "Email (SMTP)" section with the at-least-once note, the user runbook (§7), the E2E data map (§4.11), Neon pre-flight and post-check for 007 (§7 step 9).
- Ledger: deferred items carried to phases 6, 7, 8, 10 (§6).

## 4. Global constraints for the plan

### 4.1 Safety, environment, commands
- Everything in phase 4's "Global Constraints" stays: `.env.local` is the shared production Neon; never `db:migrate`, `db:psql`, `npm run dev`, `vercel env pull`; local `_test` DBs only; `RESET_DATABASE_URL=… node scripts/reset-db.mjs`; `TEST_DB_TAG`; ports E2E 3210, visual 3211 (`lsof` before, kill after); zsh rules.
- **New for phase 5:**
  - E2E/`next start` prefix gains `CRON_SECRET=<32 hex, e.g. $(openssl rand -hex 16)>`. `EMAIL_DELIVERY=log` stays explicit; never set `SMTP_*`, `EMAIL_REDIRECT_TO` or `VERCEL_ENV` for a local server.
  - Tests reach SMTP only through `test/helpers/smtp-sink.ts` on `127.0.0.1:0`; TLS relaxations only via `transportOverrides`, never env. No real SMTP server, no real email.
  - `BOTID_DEV_BYPASS=BAD-BOT` only for the one opt-in `botid.spec.ts` run (its own server on 3210 after the main run).
  - No Neon, Vercel or other external call. `withBotId`'s rewrite would proxy `/149e9513-…/` to api.vercel.com on `next start`: never request it.
- Gate per task: `npm run typecheck`; `npm run lint` (19 warnings unless a task says otherwise); `TEST_DATABASE_URL=… npm test`; reset e2e DB; `CI=1 … npm run build`; `node scripts/check-prerender.mjs`; `npm run test:e2e -- --retries=0` with the prefix; visual at 3211 (8 passed, ratio 0, never `--update-snapshots`).

### 4.2 Git
Same as phase 4: on `main`, one commit per task, `git add` named files, no push; this folder and the plan file stay untracked until the controller commits them. Attribution line per the executing session.

### 4.3 Next 16 and TypeScript 7 (phase 4's rules, plus)
- `after()` only after COMMIT, never on a path that can still roll back; before `redirect()`. Code calling an action directly in Vitest mocks `next/server`'s `after` with a `vi.hoisted` collector (E468 otherwise).
- The cron route exports only `GET` and `maxDuration`; helpers live in `lib/server/cron.ts`; it reads `request.headers` (dynamic) and answers `cache-control: no-store`.
- `cookies().set` only in the search Server Action.
- `instrumentation-client.ts` does synchronous work only.
- Email settings, `CRON_SECRET` and `BETTER_AUTH_URL` are read at call time, never at import: `next build` needs none of them.

### 4.4 Versions
- Add: `nodemailer@^10.0.13` (own types; **no** `@types/nodemailer`), `botid@1.5.11` (exact). Dev: `smtp-server@^3.19.16`, `@types/smtp-server@^3.5.13`.
- Remove: `resend`.
- Not added: `@vercel/config`, `mailparser`.
- Unchanged: next 16.3.7, react 19.3.0, typescript 7.0.2, pg 8.23.0, zod 4.6.5, react-email 6.11.0, better-auth 1.7.7, vitest 5.0.3, @playwright/test 1.63.0, oxlint 1.86.0, @vercel/functions 3.9.9; Node 22.22 local / 24 on Vercel and CI; Postgres 18.3 local.
- `npm audit` 0 after T2 and T11 (re-check).

### 4.5 Names: migration `007_email_and_consent.sql` (one transaction, expand only, re-runnable)
- **`site_settings`**: `id boolean PK DEFAULT true` + CHECK `site_settings_single_row`; `email text NOT NULL` CHECK `email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 254`; `updated_at timestamptz NOT NULL DEFAULT now()`; `updated_by text`. Seed `(true, 'fb@furamavietnam.com') ON CONFLICT DO NOTHING`.
- **`notification_recipients`**: `id bigint identity PK`; `scope` ∈ {all, destination, restaurant}; `destination_id` → `destinations` (CASCADE); `restaurant_id` → `restaurants` (CASCADE); `email` (same CHECK); `events text[] NOT NULL DEFAULT ARRAY['staff.new']` CHECK `notification_recipients_events_check` (`cardinality >= 1 AND events <@ ARRAY['staff.new']`); `locale` → `locales` DEFAULT `'vi'`; `active` DEFAULT true; `created_at/by`, `updated_at/by`; CHECK `notification_recipients_scope_target`; UNIQUE INDEX `notification_recipients_target_email_idx (scope, coalesce(destination_id,''), coalesce(restaurant_id,''), lower(email))`.
- **`email_outbox`**: `id bigint identity PK`; `env` ∈ {production, preview, development}; `event` ∈ {staff.new, guest.ack, guest.confirmed, guest.declined, guest.cancelled}; `audience` ∈ {staff, guest}; `reservation_id bigint NOT NULL` → `reservations` ON DELETE CASCADE; `reservation_event_id` → `reservation_events` ON DELETE SET NULL; `to_email` CHECK `~ '^[^@\s]+@[^@\s]+$' AND length <= 254`; `locale` → `locales`; `fallback boolean DEFAULT false`; `idempotency_key text GENERATED ALWAYS AS ('outbox:' || id::text) STORED` CONSTRAINT `email_outbox_idempotency_key_key UNIQUE`; `status` ∈ {queued, sending, sent, skipped, failed} DEFAULT queued; `attempts smallint 0..7`; `next_attempt_at DEFAULT now()`; `locked_until`; `last_error ≤ 300`; `message_id ≤ 300`; `provider_id ≤ 300`; `sent_at`; `created_at`, `updated_at`. CHECKs `email_outbox_audience_event`, `email_outbox_sending_leased`, `email_outbox_sent_at`. Indexes `email_outbox_due_idx (env, next_attempt_at, id) WHERE status IN ('queued','sending')`, `email_outbox_reservation_idx (reservation_id, id)`, `email_outbox_log_idx (created_at DESC, id DESC)`, `email_outbox_failed_idx (…) WHERE status = 'failed'`.
- **`reservations`**: `consent_version text`, `consented_at timestamptz`, CHECK `reservations_consent_check` = both NULL, or both set with `length(consent_version) BETWEEN 1 AND 40`.
- Audit entities: `notification_recipient` (create/update/delete), `site_settings` (`settings`), `email_outbox` (`update`, "Gửi lại").
- Advisory keys: `booking:<restaurant>:<date>` (unchanged), `guest-phone:<e164>:<date>`.

### 4.6 Environment variables

| Variable | Production | Preview | Local / CI |
|---|---|---|---|
| `EMAIL_DELIVERY` | `live` | `redirect` | `log` (explicit) |
| `EMAIL_REDIRECT_TO` | — | Admin's inbox | — |
| `EMAIL_FROM` | `Furama Cuisine <no-reply@…>` (an address the login may send as) | same | unset (log mode) |
| `SMTP_HOST` / `SMTP_PORT` (587 default) / `SMTP_SECURE` (`true`\|`false`; unset → port 465) / `SMTP_USER` + `SMTP_PASSWORD` (both or neither) | set | set | never set |
| `CRON_SECRET` | 16+ chars (`openssl rand -hex 32`) | optional (crons run on Production only) | random per run (E2E, CI) |
| `BETTER_AUTH_URL` | production origin (now required outside log mode, R23) | preview origin | `http://localhost:<port>` |
| `BOTID_DEV_BYPASS` | **never** | **never** | only the opt-in run |
| `VERCEL_ENV`, `NEXT_PUBLIC_VERCEL_ENV` | platform | platform | unset |
| `RESEND_API_KEY` | remove | remove | — |

`vercel.json`: `{"$schema":"https://openapi.vercel.sh/vercel.json","crons":[{"path":"/api/cron/outbox","schedule":"*/5 * * * *"}]}`.

### 4.7 Permissions (additions)

| Page or action | Permission | Editor |
|---|---|---|
| page `reservations/emails` | `reservations:read` | ✓ |
| `reservations/emails/actions.ts#resendEmail` | `reservations:update` | ✓ |
| `reservations/actions.ts#searchReservations` | `reservations:read` | ✓ |
| page `settings/notifications` | `settings:read` | ✗ |
| `settings/notifications/actions.ts#{addRecipient,editRecipient,removeRecipient,saveInbox,sendTest}` | `settings:update` | ✗ (file in `ADMIN_ONLY_ACTIONS`) |

The public allowlist stays at **6** (`submitReservation`'s justification now names zod, consent, honeypot, BotID and the per-phone limit). `GET /api/cron/outbox` is not under `/api/admin/*`; it is guarded by `CRON_SECRET`.

### 4.8 Error codes
- Guest (`BOOKING_ERROR_CODES`, before `unknown`): `consent_required`; `too_many_requests {limit, phone}`; `bot_blocked {phone}`.
- `EmailErrorCode`: `invalid_delivery_mode`, `missing_smtp_config` (was `missing_api_key`), `missing_from`, `missing_redirect_to`, `missing_app_url` (new, R23), `not_delivered`, `rejected` (new), `provider_error`.
- Admin `ActionCode`: `not_resendable`; `email_failed {error}`.
- Cron: 401 `{error:'unauthorized'}`; 500 `{error:'drain_failed'}`.
- Stored errors: `"<code>: <message>"`, ≤ 300 chars, addresses → `<redacted>`; skips `skipped: <reason>`; reaped `lease_expired: …`.

### 4.9 Constants
`RETRY_DELAYS_MINUTES = [1, 5, 15, 60, 360, 720]`; `MAX_ATTEMPTS = 7`; `LEASE_SECONDS = 120`; `SEND_TIMEOUT_MS = 30_000`; `SMTP_TIMEOUTS = {dnsTimeout 5_000, connectionTimeout 10_000, greetingTimeout 10_000, socketTimeout 20_000}`; drain defaults limit 50 / 20 s; `after()` 10 / 25 s; cron 500 / 240 s, `maxDuration 300`; `CRON_SECRET` ≥ 16; `PHONE_DAY_LIMIT = 3`; guest-phone `lock_timeout '5s'`; `PRIVACY_POLICY_VERSION = '2026-10-02'`; `INBOX_SEARCH_COOKIE = 'fc_inbox_search'`, 30 min, search 2–100 chars, id 8 hex; email log 50 rows, error clipped to 90 chars in the list; Message-ID `<outbox-{id}.{12 hex}@{domain}>`; sample reference `FC-0000TEST`; fallback locale `vi`.

### 4.10 Code rules (phase 5)
1. Outbox rows are written only by `lib/server/email/outbox.ts`, on the transaction's client, before COMMIT.
2. No SMTP I/O while holding a pool client or inside a transaction; the drain uses autocommit statements.
3. Every mark after a claim is fenced: `WHERE id = $1 AND attempts = $2 AND status = 'sending'`.
4. One `reachesSql`, one `outboxEnv`, one `EVENT_STATUSES`.
5. Logs and stored errors carry ids, events, codes and attempt numbers; never an address, name, phone, token or SMTP password (`[outbox]`, `[cron:outbox]`, `[booking]`, `[botid]`, `[email]`). A test asserts no `@` in `[outbox]` lines.
6. SQL in a JS template literal contains no backslash: use `[:space:]`.
7. Only `lib/server/email/` imports `nodemailer`; `smtp-server` only under `test/`; `resend` nowhere (guard test).
8. Lock order: guest-phone, then booking-day; staff paths take only booking-day; `pg_advisory_xact_lock` keeps one call site.
9. Guest-visible copy comes from the registry (`email.*`, `legal.*`, `error.*`, `booking.*`); new keys declare `screen`, `vars`, `context`.
10. Emails never load `reservation_notes`; guest emails never contain the admin link, the guest's phone or note.

### 4.11 E2E data map (additions; distinct restaurant×date pairs, since files run in parallel)

| Spec | Restaurant | Date or state | Cleanup |
|---|---|---|---|
| `booking-email` (T4, T13), guest booking | cafe-indochine | its last open day | none |
| `booking-email`, confirm | `seedReservation()` default | as phase 4 | none |
| `booking-email`, A3 retry | a seeded outbox row on the confirm booking | `queued`, attempts 1, due now | none |
| `admin-emails` (T7) | hai-van-lounge | +40 (staff path, seeded rows) | none |
| `admin-emails`, recipients | hura-izakaya (restaurant scope) | fresh addresses | deleted in `finally` |
| `guest-guard` (T9), per-phone | pho-cuon | today + 13, three seeded web rows for a fresh number | none |
| `guest-guard`, consent/honeypot | default drawer | nothing books | none |
| `botid` (T11, opt-in run) | default drawer | nothing books | none |

Rule: no parallel spec adds an `all` or `destination` recipient (it would reroute `booking-email`'s fallback); such cases stay in integration tests or a `*.serial.spec.ts`.

### 4.12 Baselines
At `04e0692`: unit + integration 53 files / 580 tests; E2E 110; visual 8; lint 19 warnings. The final wave adds tests; the drafter re-measures on its HEAD. Spike totals (each on its own): outbox 57/629, templates 55/664 (+1 skipped), guard 57/672.

## 5. Review focus: five conditions most likely to bite

1. **Double send or lost email under concurrency and retries.**
   - Check: claim uses `FOR UPDATE SKIP LOCKED` and the lease (`status='queued' OR (status='sending' AND locked_until < now())`); every mark is fenced; attempts count at claim; reaping only `attempts >= 7`; `requeueEmail` decides on the locked row (not a CTE snapshot) and refuses `sending`; the `sent` mark failing after a send does not schedule a retry (C14); `after()`, cron and "Gửi lại" racing on one row send once.
   - Lost: a row that never reaches a terminal state (reaping), a row in an env no sender drains, `drainAfterCommit` missed on a path (bulk cancel `finally`), a queue function that silently inserts nothing (address filter must only drop invalid addresses).
   - Evidence: the concurrency, crash, fencing and reaping tests with M1/M2/M4 red.
2. **Email to the wrong person, or a PII leak.**
   - Redirect mode rewrites every recipient; env filter on every drain query; a guest row is skipped when the booking's address changed; recipients union is correct and deduped; guest emails reply to the shared inbox, never to a staff member's address.
   - No address, name or phone in logs, `last_error`, `provider_id`, Message-ID, URLs (`tab`/`sau`/`tim` only) or the cron response; `deliveryModeNotice` shows the mode only; internal notes never rendered; `status_reason` reaches the guest only on decline/cancel; the email log masks guest addresses.
   - Preview: forked recipients only reachable through redirect.
3. **A booking failing because email failed.**
   - Queue SQL inside the booking transaction must not throw on data a guest can send: address filter before the CHECK, FK-safe locale, no recipient → fallback row (never zero rows → no error). A throw here aborts the booking: the rollback test proves the coupling, the address tests prove it cannot be triggered by input.
   - After COMMIT nothing email-related can turn success into failure: `drainAfterCommit` only schedules; `drainQuietly` never throws; SMTP config errors surface at send time inside the drain; `next build` and startup read no SMTP env.
4. **Cron or secret exposure.**
   - `cronAuthorized` constant-time over hashes; missing or short secret → 401; no secret, SMTP host/user/password or redirect address in any response, log line or admin page; `no-store`; route dynamic (`ƒ`); proxy matcher skips `/api`; `BOTID_DEV_BYPASS` ignored on deployments; `SMTP_PASSWORD` never trimmed, never echoed in `missing_smtp_config` messages.
5. **Bots or one phone flooding bookings.**
   - Order in `submitReservation`: honeypot → BotID → zod (consent) → transaction (phone lock → count → day lock → rules → insert → outbox) → COMMIT → `after()`.
   - The phone count runs under its own lock (the 6-way race); lock order never inverted; `lock_timeout` bounds waits with pool max 5; BotID fails open but logs; the client protect list covers every guest path (`/*` POST) and never `/admin`; the proxy does not redirect BotID's prefix; availability's cheap 400/404 run before any query.

## 6. Known risks

Labels: **Accepted** (consequence of a ruling, or mitigated) or **Needs decision** (the user chooses).

1. **Accepted (R1).** Duplicates are possible (crash after 250, 30 s cap during DATA, mark failure). Same Message-ID on every copy; Gmail often, not always, collapses them.
2. **Needs decision (first preview).** Outbound 587/465 from Vercel Functions is unverified (port 25 is blocked). Check with "Gửi email thử" in redirect mode.
3. **Needs decision (when the provider is known).** Provider limits: Microsoft 365 needs Authenticated SMTP per mailbox and caps daily recipients (a quota 5xx at DATA is retried, R6); Google Workspace needs an app password and has daily caps. Each web booking sends 1 guest + N staff emails.
4. **Needs decision (user, IT Furama).** Deliverability: `EMAIL_FROM` must be a permitted sender; SPF, DKIM for the From domain, DMARC aligned (start `p=none`).
5. **Accepted.** Vercel Cron runs on Production only. On Preview, a failed email waits for a later write's `after()` or "Gửi lại".
6. **Accepted.** A cron run can overlap another run or an `after()` drain; claim + lease make that safe.
7. **Needs decision (first preview).** BotID needs "Automatically expose System Environment Variables" (client gate) and OIDC (server). If off, the client skips silently or the server fails open with `[botid] check failed`.
8. **Needs decision.** BotID fails open (R16) and refuses verified bots, AI booking agents included. Deep Analysis is billed per check (pricing not verified offline).
9. **Accepted (phase 10).** The static guest CSP must allow BotID's scripts (same-origin via rewrite; Deep Analysis may need wasm/eval).
10. **Needs decision (user, lawyer).** The privacy text is an EN draft (Law 91/2025/QH15): controller identity, processors (Vercel, Neon, SMTP provider), 24-month wording; VI text to supply. The version moves with each text change (hash test).
11. **Accepted.** ICU strings pinned on Node 22 (`Thứ Hai, 5 tháng 10, 2026`, `7:00 PM`) may differ by a character on Node 24 in CI; loosen to contains-checks if red.
12. **Accepted.** Rebase cost: the spikes predate the final wave; T3, T9, T10 and T12 touch files the wave rewrote.
13. **Accepted (R22).** Preview forks production staff and recipients; redirect mode is mandatory there; a Preview reset changes only the Preview branch.
14. **Accepted (phase 10 contract).** The anonymiser overwrites `email_outbox.to_email` with a placeholder that passes the CHECK (`anonymized@invalid`); `last_error`, `provider_id` and `message_id` hold no personal data; consent columns are kept.
15. **Accepted (phase 6 contract).** `site_settings` already exists; phase 6 alters it.
16. **Accepted.** A guest submit takes two advisory locks and one count query; with pool max 5 a burst queues, and a timeout shows `error.network`.
17. **Accepted.** The search cookie keeps guest PII on the staff browser for up to 30 minutes (httpOnly, path-scoped).
18. **Accepted (R8).** `status_reason` typed in Vietnamese can reach an English email verbatim; the reason field warns staff.
19. **Accepted.** Non-en/vi recipient locales get English copy with that locale's date format.
20. **Accepted.** `withBotId` rewrites exist in local builds; a manual request to the BotID prefix on `next start` would reach api.vercel.com.
21. **Needs decision (measure in T5).** react-email's CLI dependencies in production `dependencies`; act only if the function size is at risk.
22. **Accepted.** A tab opened before phase 5 deploys sends no consent and gets `consent_required`; the site has never been deployed.
23. **Accepted.** E2E load grows by about 15 tests; the BotID blocked-path E2E is opt-in and not in CI.

Carried to later phases (ledger in T13): phase 6 `site_settings` columns via ALTER; phase 7 editable `email.*`/`legal.*` (version from the save, not the hash), `serverActions.bodySizeLimit` scoped to uploads, form-kit items; phase 8 VI legal copy, `locale ?? 'en'`; phase 10 anonymiser (`to_email`, consent kept), CSP with BotID, retention tied to `legal.keep_body`.

## 7. User runbook (README, T13)

**Before email goes live**
1. **SMTP account:** host, port 587 (STARTTLS) or 465 (TLS), username, password or app password. Microsoft 365: enable "Authenticated SMTP" for that mailbox. Google Workspace: app password.
2. **`EMAIL_FROM`:** e.g. `Furama Cuisine <no-reply@mail.furamavietnam.com>`; an address or alias the login may send as.
3. **DNS at the mail provider (IT Furama):** SPF include of the provider, DKIM signing for the From domain, DMARC (check the root domain first; start `p=none`).
4. **Vercel → Environment Variables, Production:** `EMAIL_DELIVERY=live`, `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` (`SMTP_SECURE` only if the port rule does not fit), `CRON_SECRET` (`openssl rand -hex 32`), `BETTER_AUTH_URL` = production origin.
5. **Preview:** `EMAIL_DELIVERY=redirect`, `EMAIL_REDIRECT_TO=<Admin's inbox>`, `EMAIL_FROM`, `SMTP_*` (a separate login if possible). Remove `RESEND_API_KEY` from every environment.
6. **Vercel Pro is active.** After the first Production deploy: Project → Settings → Cron Jobs shows `/api/cron/outbox` every 5 minutes.
7. **BotID:** turn on "Automatically expose System Environment Variables" and OIDC Federation; decide on Deep Analysis; never set `BOTID_DEV_BYPASS`.
8. **Recipients:** give the notification emails per restaurant or destination (spec §15 item 15); confirm `fb@furamavietnam.com` as the shared inbox (fallback and guests' replies).
9. **Migration 007 on Neon** (controller, read-only pre-flight first):
   - `SELECT name FROM _migrations ORDER BY name` → ends at `006_booking_v2.sql`.
   - `SELECT to_regclass('site_settings'), to_regclass('notification_recipients'), to_regclass('email_outbox')` → all NULL.
   - `SELECT current_setting('server_version_num')::int >= 130000` → true (`gen_random_uuid`).
   - `SELECT column_name FROM information_schema.columns WHERE table_name = 'reservations' AND column_name IN ('consent_version','consented_at')` → none.
   - Apply 007 in the phase-5 deploy window; post-check `SELECT email FROM site_settings` = `fb@furamavietnam.com` and `SELECT attgenerated FROM pg_attribute WHERE attrelid = 'email_outbox'::regclass AND attname = 'idempotency_key'` = `s`.

**First preview checks**
10. `/admin/settings/notifications` → "Gửi email thử" arrives at the redirect inbox (proves 587/465 reach, credentials, DKIM/SPF pass in the headers).
11. Book a test table from a browser: staff and guest emails arrive (redirected); function logs show no `[botid] check failed`; the BotID traffic view shows the check.

**Decisions to give** (defaults proposed in §2): R8 defaults (Báo khách on, also for closures), R10 (VI email for VI bookings), R11 Reply-To, R14 limit definition and number 3, R16 fail-open and verified bots, R17 policy wording and VI text, R22 Preview inbox.
