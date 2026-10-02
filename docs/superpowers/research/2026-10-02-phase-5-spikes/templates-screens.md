# Phase 5 spike: booking email templates (EN/VI) and the staff email screens

> Spike report, key `templates-screens` (clone `p5-templates`). Topic: booking email templates in EN/VI (registry-driven, react-email), the SMTP transport behind the EMAIL_DELIVERY gate, and the staff email screens (email log with "Gửi lại", the booking's emails, `/admin/settings/notifications` with recipients, shared inbox and "Gửi email thử", overview counts).
> Where this report and `00-plan-outline.md` disagree, **the outline wins** (see its §0 and §2). In particular the outline takes outbox-core's migration, transport, sink and Message-ID, keeps this spike's render modules, screens and direct "Gửi email thử", and narrows `guest.confirmed` to `confirmed`.

## 0. Where the work is
- Clone: `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p5-templates`, branch `p5-templates`, commit `ad4c3eb`. Its base is `04e0692`, with the 4 in-flight RED test files of the phase-4 final wave reset to HEAD.
- The full file contents are in the patch `…/scratchpad/p5tpl-logs/p5-templates.patch`: 52 files, +3746/−235. That is the reliable copy of every file.
- Logs: `…/scratchpad/p5tpl-logs/` (`test-2.log`, `build-3.log`, `e2e-1..3.log`).
- Screenshots: `…/scratchpad/p5tpl-logs/shots/`:
  - the rendered emails: `guest-confirmed-en.png/.txt`, `test-staff-new-vi.png/.txt`;
  - the screens: `final-email-log.png`, `final-email-log-390.png`, `notifications.png`, `detail.png`, `overview.png`.
- The main repo, its DBs and ports 3210/3211 were never touched.
- The spike's DBs (`furama_cuisine_p5tpl_test`, `furama_cuisine_migrate{,004,005,006}_p5tpl_test`) were dropped at the end. Ports 3230 and 3231 are free.

## 1. Gates (final state)
- `npm run typecheck`: green.
- `npm run lint`: exit 0 with 19 warnings, the same as the baseline.
- `TEST_DB_TAG=p5tpl TEST_DATABASE_URL=…/furama_cuisine_p5tpl_test npm test`: **Test Files 55 passed, Tests 664 passed | 1 skipped**. The skipped test is the F2 consistency test, which runs once `booking.done_*` lands on main (it has: `bf20f55`).
- `next build` (CI=1, local DB): exit 0.
  - `/admin/reservations/emails` and `/admin/settings/notifications` are ƒ (dynamic).
  - `node scripts/check-prerender.mjs`: all checks pass ("Admin check … have no static shell").
  - nodemailer is bundled by Turbopack. No `serverExternalPackages` entry was needed, and smtp-server and mailparser do not reach `.next/server`.
- Targeted E2E (`E2E_PORT=3230`, `EMAIL_DELIVERY=log`, `--project=desktop --retries=0`), covering admin-emails, admin-reservations and admin-acceptance: **16 passed**. An earlier run that also included admin-audit: 20 passed.
- **3 builds** were run, one more than the suggested two. The third verified the final UI and semantics changes.

## 2. SMTP transport (replaces Resend for ALL email)
File: `lib/server/email/send.ts`. `resend` is removed from package.json, and `nodemailer@10.0.13` is added.

**Environment**, read at send time and never at import:

| Variable | Meaning |
|---|---|
| `EMAIL_DELIVERY` | `log` (default), `redirect` or `live`. An unknown value throws `invalid_delivery_mode`. |
| `EMAIL_REDIRECT_TO` | Target inbox for `redirect`. |
| `EMAIL_FROM` | Sender address. |
| `SMTP_HOST` | Server host. |
| `SMTP_PORT` | Default 587. |
| `SMTP_SECURE` | `true` or `false`. Unset means `true` only on port 465. |
| `SMTP_USER`, `SMTP_PASSWORD` | Login. |

**Behaviour:**
- `smtpOptionsFromEnv(env)` returns `{host, port, secure, requireTLS: !secure, auth, connectionTimeout 10s, greetingTimeout 10s, socketTimeout 20s, dnsTimeout 10s}`. STARTTLS is **required**, never opportunistic.
- An error says `missing_smtp_config`; the message never contains the password.
- The outbox-core spike's `smtp.ts` also allows no-auth (user and password both or neither). Prefer that variant.
- **Message-ID:** `messageIdFor('outbox:42', from)` returns `<outbox-42@mail-domain>`. It comes from `idempotencyKey`; invites become `<invite-<id>-<hash16>@…>`.
- **`replyTo`** is supported.
- **Return value:** `{ mode, id: messageId, response: info.response }`. The response looks like "250 … queued as …".
- **Errors:** every failure is an `EmailSendError('provider_error', 'SMTP <code> (<responseCode>): <msg>', { permanent })`. `permanent` is true for 5xx on EENVELOPE/EMESSAGE only.
- `describeEmailError` now runs `redactEmails()`, which reduces addresses to `*@domain`. SMTP 550 replies quote the recipient.
- `EmailErrorCode`: `missing_api_key` became `missing_smtp_config`, and `lib/admin/auth-errors.ts` and its test follow the rename.
- The guard `lib/server/email/transport-import.guard.test.ts` replaces the Resend guard: only `lib/server/email/` may import nodemailer, resend or smtp-server.

**Test sink:** `test/helpers/smtp-sink.ts`.
- It uses `smtp-server@3.19.16` and `mailparser@3.9.33` as devDependencies. Neither ships types, so `test/types/smtp-sink-modules.d.ts` declares the slice used.
- `@types/nodemailer`/`@types/smtp-server` were **not** installed: the spike believed @types/nodemailer 8 would shadow nodemailer 10's own types. (The lead checked: outbox-core installed `@types/smtp-server`, which pulls `@types/nodemailer` 8 in as a types reference, and typecheck stayed green; nodemailer's own sibling `.d.ts` files win for module imports.)
- It listens on 127.0.0.1, port 0, and speaks real STARTTLS with smtp-server's built-in localhost cert. `AUTH` is `mailer@furama.test` / `sink-password-0123`.
- It can reject recipients with 550 and fail DATA with 4xx or 5xx.
- `createTransport` adds `tls: { rejectUnauthorized: false }`, injected only through `createEmailSender({ createTransport })` in tests.

Verified in `lib/server/email/email.test.ts` (26 tests):
- STARTTLS and AUTH;
- the Vietnamese subject arriving intact, and multipart/alternative;
- a deterministic Message-ID and Reply-To;
- redirect rewriting, with `[original] subject`;
- 550 is permanent and its stored text keeps no address;
- EAUTH and a refused connection (port 1) are retryable; DATA 451 is retryable and 554 is permanent;
- log mode never opens a connection.

## 3. Registry keys (`lib/i18n/registry.ts`, screen `'emails'`, every key EN + VI)
- **Shared labels**, `email.common.*`:
  - `label_reference`, `label_restaurant`, `label_date`, `label_time`, `label_guests`, `label_reason`;
  - `time_value` = "{time} (Da Nang time, GMT+7)";
  - `contact` = "Questions or changes? Please call us on {phone}.";
  - `footer_guest`, `footer_staff`.
- **Per guest event**, `email.guest.{ack,confirmed,declined,cancelled}.{subject,heading,intro}`. Every subject carries `{reference}` and every intro `{restaurant}`.
- **Staff**: `email.staff.new.{subject,heading,intro_requested,intro_confirmed,label_guest,label_phone,label_email,label_note,button}`. The EN subject says "party of {guests}" to avoid "1 guests"; VI says "{guests} khách".
- **F2 alignment:**
  - `email.guest.ack.intro` EN equals F2's `booking.done_requested`.
  - `email.guest.confirmed.intro` EN equals F2's `booking.done_confirmed` ("Your table at {restaurant} is confirmed. We look forward to welcoming you.").
  - Test `render.test.ts` (`it.skipIf(!REGISTRY['booking.done_requested'])`) pins the two together. The plan should make it unconditional: F2 is on main since `bf20f55`.

## 4. Rendering
Files: `lib/server/email/booking/render.ts`, `format.ts`, `sample.ts`, `templates/booking.tsx`, plus a generalized `templates/layout.tsx` (`lang` and `footer` props; the staff account emails keep their Vietnamese defaults).

```ts
emailKeys(event: EmailEvent): EmailKey[]                       // the registry keys one email reads
buildBookingEmail(event, data: BookingEmailData, strings: Record<EmailKey,string>, locale: {code,bcp47}, { adminOrigin }) // PURE → { subject, preview, element }
loadBookingEmailData(db, reservationId)                        // reservation + restaurant name + groupPhoneSql('t'); NO reservation_notes
resolveEmailLocale(db, requested, audience)                     // guest: requested if locales.is_enabled else default; staff: requested always
loadEmailStrings(db, event, locale)                             // loadStringRows(locale, keys, db) + resolveStrings (same visibility rules as the site; uncached)
renderBookingEmail(db, { event, reservationId, locale }, { adminOrigin? }) → { subject, html, text, replyTo?, locale } | null
renderSampleEmail(pool, event, locale, { adminOrigin })        // "[Email thử] " + sample booking FC-0000TEST (no guest data)
```

**Content rules:**
- Content is rendered **at send time** from the reservation, so `email_outbox` holds no guest text except `to_email`.
- Dates and times are formatted as UTC instants of the Da Nang calendar date and time (`timeZone: 'UTC'`):
  - date: `dateStyle: 'full'`; the staff subject uses a short date (weekday, day, month, year);
  - time: `timeStyle: 'short'`, which gives en "7:00 PM" and vi "19:00";
  - an unknown tag falls back to `en`.
- The vi tag in `locales.bcp47` is `'vi'`.

**Plain text:**
- The details table is a plain `<table data-text-format="dataTable">`. react-email's `plainTextSelectors` then print aligned "Label   value" lines; without it html-to-text glued them into "ReferenceFC-…".
- `renderEmail` adds `{ selector: 'a[href^="tel:"]', format: 'anchor', options: { ignoreHref: true } }`. html-to-text throws "no specified format" without `format`.
- The staff fallback link has `data-skip-in-text="true"`, so the URL appears once in the text part.

**Who sees what:**
- Guest emails contain the destination's phone (`groupPhoneSql`, shared with `loadBookingRules`) as a `tel:` link. They never contain the admin link or the guest's phone or note.
- Declined and cancelled emails quote `status_reason` verbatim; ack and confirmed never show it.
- `staff.new` contains the guest's name, phone, email and own request, plus a button to `${appOrigin()}/admin/reservations/{id}`. Its intro depends on `requested` versus `confirmed` (auto-confirm).
- Internal notes are never loaded; an integration test seeds one and asserts it is absent.
- Guest text is escaped (XSS test).

**Reply-To:**
- staff emails: the guest's email;
- guest emails: `site_settings.email`.

**Loader change:** `lib/server/content/strings.queries.ts#loadStringRows` gained an optional `db` argument. `getStrings` uses `'use cache'`/`cacheTag`, which throw outside Next, and the sender runs in `after()`, cron and Vitest.

Key code (`render.ts`, read by the lead): `buildBookingEmail` formats details with `formatMessage(strings[key], params, locale.code)`; the guest branch picks `[subject, heading, intro]` per event, quotes `statusReason` only for declined/cancelled, and adds `contact` from `groupPhone`. `resolveEmailLocale` reads `SELECT code, bcp47, is_enabled, is_default FROM locales WHERE code = $1 OR is_default`. `sharedInbox(db)` reads `SELECT email FROM site_settings WHERE id`.

## 5. Data shape built against (stub `db/migrations/007_email.sql`; outbox-core owns the final file)
- **site_settings:** a one-row table holding only `email`, seeded `fb@furamavietnam.com` (CONTACT.email). This is the phase-5 fallback store: spec §10.4 already names `site_settings.email`, and phase 6 adds the other columns with `ADD COLUMN IF NOT EXISTS`. outbox-core reached the same decision.
- **notification_recipients:**
  - columns: `scope` all/destination/restaurant, `destination_id`, `restaurant_id`, `email`, `events text[] ⊆ {'staff.new'}`, `locale` (default `'vi'`, FK locales), `active`;
  - the `scope_target` CHECK;
  - a unique index `(scope, coalesce(destination_id,''), coalesce(restaurant_id,''), lower(email))`.
- **email_outbox:**
  - spec §5.2 columns plus `id`, `created_at`, `updated_at`;
  - `idempotency_key GENERATED ALWAYS AS ('outbox:' || id) STORED UNIQUE`, verified on PG 18.3 (a generated column may reference an identity column);
  - status queued/sent/failed/skipped; `last_error` ≤ 300.

**Deltas from outbox-core's `p5-outbox/db/migrations/007_email_outbox.sql`** (adopt theirs):
- status adds `'sending'`;
- `attempts` is CHECKed 0..7;
- `reservation_id` is nullable, plus event `'staff.test'`, `created_by`, `reservation_event_id`, `fallback`, `message_id`;
- `reservation_events` is unchanged.

The screens need these changes for that shape:
- `sending` becomes `status = 'sending' AND locked_until > now()`;
- the log uses LEFT JOIN reservations if `staff.test` rows exist;
- the failed count excludes `staff.test` (or the plan rules it in);
- "Gửi lại" is hidden for `staff.test`.

(Outline R9 drops `staff.test`, so the last three points disappear.)

## 6. Recipients and resolution (`lib/server/email/recipients.ts`)
- The `reaches(n, r, event)` SQL fragment is the one definition, used by both `staffRecipients` (the sender) and `restaurantsWithoutRecipient` (the overview and settings page):

  ```sql
  n.active AND $event = ANY(n.events) AND (n.scope='all' OR (n.scope='destination' AND n.destination_id = r.destination) OR (n.scope='restaurant' AND n.restaurant_id = r.id))
  ```

- `staffRecipients(db, restaurantId)`:
  - `DISTINCT ON (lower(email))`, where the most specific scope's locale wins;
  - with no match, returns `{ recipients: [{ email: site_settings.email, locale: 'vi' }], fallback: true }`.
- `restaurantsWithoutRecipient` counts `booking_enabled` restaurants only.
- CRUD (`createRecipient`/`updateRecipient`/`deleteRecipient`, `saveSharedInbox`):
  - each save is `withTransaction` + `insertAudit`, with entity `notification_recipient` (create/update/delete) or `site_settings` (action `settings`);
  - the `updated_at` µs token goes through the exported `US`/`conflictBy`/`Conflict` from `lib/server/booking/config.ts`;
  - a duplicate is detected by `err.constraint === 'notification_recipients_target_email_idx'`;
  - `audit-labels.ts` gains the entity labels "Người nhận thông báo" and "Cài đặt chung".

## 7. Email log, "Gửi lại", overview (`lib/server/email/outbox-log.ts`)
- **Env scoping:** `emailEnv()` (`lib/server/email/env.ts`) returns VERCEL_ENV production or preview, else `development`. Every read and write filters on `o.env`. outbox-core calls this `outboxEnv()`; keep one.
- **`listEmailLog`:** keyset on `(created_at DESC, id DESC)` with a µs cursor, 50 per page, `tab` in all/failed/queued/sent/skipped. The URL holds only `tab` and `sau`, never an address (the SEC-2 lesson).
- **Other reads:** `listReservationEmails(db, id, env)` and `countFailedEmails(db, env)`.
- **`requeueEmail(pool, { id, env })`** is one UPDATE whose conditions sit on the locked row:

  ```sql
  … WHERE o.id=$1 AND o.env=$2 AND (o.status='failed' OR (o.status='queued' AND (o.locked_until IS NULL OR o.locked_until <= now())))
  SET status='queued', next_attempt_at=now(), locked_until=NULL, attempts = CASE WHEN o.status='failed' THEN 0 ELSE o.attempts END
  ```

  - A failed row gets fresh attempts, matching outbox-core's `requeueFailed`. A waiting row just becomes due now.
  - It refuses sent, skipped and currently-held rows with `not_allowed`, which the action maps to `ActionCode 'not_resendable'`.
  - A first version used CTE snapshot values: a concurrent claim could have been reset. Fixed.
  - No `reservation_events` row is written, aligned with outbox-core: a send is not a booking change.

**Action** `app/admin/(shell)/reservations/emails/actions.ts#resendEmail`:
- `reservations:update`, so Editor and Admin;
- `after(async () => drainOutbox(pool, { ids: [id] }))` (`after.md:8` allows `after()` in Server Functions);
- **no `refresh()`**: on the "Lỗi" tab a refresh would drop the row, and its "Đã đưa vào hàng gửi…" notice, before the send even ran.

**Page** `/admin/reservations/emails` (`instant = false`, `requirePagePermission({ reservations: ['read'] })`):
- tabs, the `deliveryModeNotice()` line (mode only; never SMTP settings or the redirect address), and 6 columns: Email · tạo lúc / Người nhận / Đặt bàn / Trạng thái (+ sent time, next attempt, "n lần gửi") / Lỗi gần nhất (redacted, clipped to 90 characters) / Thao tác;
- **guest addresses masked** with `maskEmail` → `l•••@gmail.com`; staff addresses in full;
- a new "Email" link in the reservations `SectionNav`;
- new CSS: `.a-status--email-{queued,sending,sent,failed,skipped}`, `.a-error-text` (break-word, 20–40ch), `.a-table-scroll` (overflow-x: auto; at 390 px the page scrollWidth is 390), `.a-resend .a-btn { white-space: nowrap }`.

**Booking detail page:** a new "Email" section (`a-table--compact` inside `.a-table-scroll`, aria-label "Email của đặt bàn"). The full address shows there, the error is unclipped, and "Gửi lại" works for failed and waiting rows.

**Overview `/admin`:**
- for `reservations:read`: "N email lỗi", linking to `?tab=failed` (`data-testid="failed-emails"`);
- for `settings:read`: a section "Nhà hàng chưa có người nhận thông báo" naming the restaurants and noting they go to the shared inbox.

## 8. Notification settings `/admin/settings/notifications` (Admin only)
- **Page:** `requirePagePermission({ settings: ['read'] })`. Nav item "Thông báo email" (`settings:read`); the nav test is updated.
- **Recipients:** `RecipientEditor` follows the ClosureEditor pattern:
  - `useActionState` lives in the parent; the fields remount on the token or the count of successful adds (code rule 9);
  - `method="post"` with `submitKeepingValues`; `useId` ids;
  - inputs: scope select plus restaurant or destination picker (destinations from `DESTS`), locale select (`listLocales`), a staff-event checkbox (staff.new "Đặt bàn online mới"), and active;
  - `DeleteRecipient` uses a confirm.
  - A duplicate address returns `invalid` with `fieldErrors.email` "Địa chỉ này đã nhận thông báo cho cùng phạm vi."
- **Shared inbox:** `SharedInboxForm` (token, `key={token}`).
- **"Gửi email thử":** `TestEmailForm` takes to (default: the staff member's own email), template (any of the 5 events) and language. `sendTestEmail` (`lib/server/email/test-email.ts`) **sends directly through the gate and awaits**; it does not use the outbox. It returns:
  - `{ ok, data: { mode, to } }`, where redirect reports `EMAIL_REDIRECT_TO`;
  - or `{ ok: false, code: 'email_failed', params: { error } }`, with a Vietnamese hint from `emailFailureHint()`: missing SMTP, EAUTH, connection, or 5xx envelope.
  - A fresh `idempotencyKey: test:<Date.now base36>` per click, so two tests are two emails; the log line carries only the error code.
- **Actions** (`settings/notifications/actions.ts`): `addRecipient`, `editRecipient`, `removeRecipient`, `saveInbox` and `sendTest`. All require `settings: ['update']`, followed by `refresh()` (nothing is cached).
- **Schemas:** `lib/admin/notification-schemas.ts`. `EmailAddress = z.string().trim().min(1).max(254).pipe(z.email())` (it trims, unlike a bare `z.email()`).
- **New ActionCodes:** `not_resendable` and `email_failed`, in `action-result.ts` and `auth-errors.ts`.

**CI guard** (`test/guards/require-permission.guard.test.ts`):
- `ADMIN_ONLY_ACTIONS` += `settings/notifications/actions.ts`.
- `BOOKING_ACTIONS` rows:
  - `resendEmail`: reservations:update, Editor ✓;
  - the 5 notification actions: settings:update, Editor ✗.
- A mutation check: changing `sendTest` to `reservations:update` turns 2 guard tests red ("an Editor passes requirePermission"). Restored afterwards.

## 9. Sender stub (`lib/server/email/drain.ts`; outbox-core owns the real one)
- **Claim:** one autocommitted `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`. It sets a 120 s lease and `attempts + 1` before the send, and can be filtered by `ids` and env.
- **Skip:** a row is skipped when `EVENT_STATUSES[event]` (`lib/email/events.ts`) no longer contains the booking's status. `guest.ack` needs requested; `guest.confirmed` accepts confirmed or seated.
- **Send and mark:** render, send, then mark sent, fenced on `attempts = claimed`.
- **On failure:** retry after 1/5/15/60/360/720 minutes. Permanent errors, or attempts ≥ 7, become failed. `console.error` logs `{outbox, code, final}` only, with no address.
- Verified over the sink: sent once with the Message-ID; the 1 m then 5 m schedule; a refused address fails at once; the 7th failure becomes failed and counts on the overview; ids and env filters; a held row is left alone until its lease ends.

`lib/email/events.ts` (client-safe, no `server-only`): `GUEST_EMAIL_EVENTS`, `STAFF_EMAIL_EVENTS`, `EMAIL_EVENTS`, `isEmailEvent`, `audienceOf`, `EMAIL_EVENT_LABELS` (Vietnamese: "Báo nhân viên: đặt bàn mới", "Khách: đã nhận yêu cầu", "Khách: đã xác nhận", "Khách: bị từ chối", "Khách: đã hủy"), `EMAIL_STATUSES` + labels ("Đang chờ gửi", "Đã gửi", "Lỗi", "Bỏ qua"), `maskEmail`, `EVENT_STATUSES`.

## 10. Tests added
- `lib/server/email/booking/render.test.ts`, 24 tests:
  - 10 event × locale renders;
  - the plain-text table; the guest/staff content split; the reason rules; the F2 wording;
  - the staff subject in VI and EN; escaping; no phone, no contact line; the link appearing once in text;
  - the event list equals the 007 CHECK.
- `test/integration/email-screens.test.ts`, 20 tests:
  - the locale fallback with vi disabled versus enabled;
  - content_strings overrides (a reviewed en row applies; an unreviewed machine vi row does not);
  - no internal notes; the destination phone; Reply-To; null for a missing booking;
  - recipient merge, dedupe and fallback; the uncovered list;
  - CRUD with audit and conflict; duplicates by case; the shared inbox;
  - log paging, env and tabs; requeue semantics; the stub sender; the test email in live, redirect and EAUTH.
- `e2e/admin-emails.spec.ts`, 4 tests:
  - an Editor sees a failed email on the overview and the log (masked, "7 lần gửi"); "Gửi lại" turns it sent via `after()` (polled in the DB, found in `EMAIL_LOG_FILE`); the detail page shows it with "1 lần gửi";
  - a refused resend of a sent row;
  - the Editor's 403 on settings;
  - the Admin adds a recipient for Hura Izakaya, a duplicate is refused at the field, and a test email lands in `EMAIL_LOG_FILE` with subject `[Email thử] Đặt bàn mới FC-0000TEST: Tàya House, … 19:00, 4 khách`.
- E2E data: Hải Vân Lounge at +40 days, and fresh recipient addresses that the spec deletes in `finally`.

## 11. Errors hit
1. **8 tests failed in the very first baseline run** (`input.test.ts`, `client.test.ts`, `registry.test.ts`).
   - Cause: the clone copied the main working tree's uncommitted RED tests of the phase-4 final fix wave (written test-first, product code not yet changed).
   - Fix: `git checkout --` of those 4 files in the clone only; baseline then green. The plan must rebase phase 5 on the committed final wave.
2. **`lib/admin/auth-errors.ts` TS2353:** `'missing_api_key'` does not exist in type `Record<EmailErrorCode, boolean>`.
   - Cause: `EmailErrorCode` changed when Resend was replaced (`missing_api_key` → `missing_smtp_config`); `EMAIL_SETUP_ERRORS` is an exhaustive Record.
   - Fix: renamed the key in `auth-errors.ts` and its `it.each` case in `auth-errors.test.ts`.
3. **Vietnamese time rendered `'0:30'` instead of `'00:30'`.**
   - Cause: Intl `hour:'numeric'` gives a 1-digit hour in vi.
   - Fix: `formatEmailTime` uses `{ timeZone:'UTC', timeStyle:'short' }` → en '7:00 PM', vi '19:00'/'00:30'.
4. **Plain text read `'ReferenceFC-7K3QH9XARestaurantTàya House…'`** (labels glued to values).
   - Cause: html-to-text's default table handling inside react-email `render(plainText)`.
   - Fix: the details table carries `data-text-format="dataTable"` (react-email's `plainTextSelectors` maps it to html-to-text's dataTable) → aligned 'Label   value' lines.
5. **Plain text printed `'+84 236 651 9999 tel:+842366519999.'`**
   - Cause: html-to-text appends href when link text differs.
   - Fix: `renderEmail` adds `{ selector: 'a[href^="tel:"]', format: 'anchor', options: { ignoreHref: true } }`; without `format` html-to-text throws 'Following selectors have no specified format'.
6. **Staff admin link appeared twice in the text part.**
   - Cause: Button + fallback Link both converted.
   - Fix: fallback `<Text data-skip-in-text="true">` (react-email's skip selector); a test pins once in text, twice in html.
7. **Integration test expected `lang="vi-VN"` but got `lang="vi"`.**
   - Cause: `locales.bcp47` for vi is seeded as `'vi'` (migration 004).
   - Fix: tests use the seeded tag; unit tests use `{ code:'vi', bcp47:'vi' }`.
8. **`content_strings` insert rejected origin `'machine'`.**
   - Cause: CHECK origin IN ('human','ai','seed'); status is 'machine'|'reviewed'.
   - Fix: the test row uses status `'machine'`, origin `'ai'`.
9. **`ReferenceError: content is not defined`** (moved SMTP tests).
   - Cause: the `content` fixture was scoped to the old 'delivery modes' describe.
   - Fix: declared it in the new describe.
10. **oxlint no-shadow warning** (20 instead of baseline 19).
    - Cause: a `'sink'` local array shadowed the SMTP sink in the same describe; an E2E local named `test`.
    - Fix: renamed to `logged` / `trial`; lint back to 19.
11. **Requeue race:** a requeue could clear the lease of a row a sender claimed concurrently.
    - Cause: the first version decided from a CTE snapshot (`t.status`/`t.held`) rather than the row being updated.
    - Fix: all conditions moved onto the UPDATE's own row (re-evaluated under the row lock); found/not_allowed derived after.
12. **Email log showed '8/7' attempts after a manual resend; table wider than 1280 px; errors wrapped per character; 'Gửi lại' button wrapped.**
    - Cause: resend kept attempts (7) then the claim made 8; 8 columns + `overflow-wrap:anywhere` + min widths.
    - Fix: aligned with outbox-core: a failed row restarts at attempts=0; attempts shown as 'n lần gửi' under the status; merged event+time column (6 columns); `.a-error-text` break-word 20–40ch, clipped to 90 chars in the list; `.a-table-scroll` wrapper; `.a-resend` nowrap. Verified by screenshot at 1280 and 390.
13. **After 'Gửi lại' on the 'Lỗi' tab the success notice vanished.**
    - Cause: `refresh()` redraws the page and the requeued row leaves the failed tab, unmounting the form with its notice.
    - Fix: `resendEmail` no longer calls `refresh()`; the notice says to reload in a few seconds (the send runs in `after()`).

## 12. Package versions
- `nodemailer@10.0.13` (dependency, added; ESM; ships its own types at `dist/esm/nodemailer.d.ts` and `dist/cjs`; engines node>=20; types work with TypeScript 7.0.2: `import { createTransport, type NodemailerError, type SMTPTransportOptions } from 'nodemailer'`; bundled by Turbopack under next@16.3.7 with no `serverExternalPackages`).
- `smtp-server@3.19.16` (devDependency, added; its own dependency is nodemailer 10.0.13; no types: local `test/types/smtp-sink-modules.d.ts`).
- `mailparser@3.9.33` (devDependency, added; depends on nodemailer 10.0.13; no types: same local d.ts).
- `resend@6.31.0` removed (dependency).
- NOT installed on purpose: `@types/nodemailer@8.0.2` and `@types/smtp-server@3.5.13` (see §2 for the lead's check).
- Unchanged: next@16.3.7, react@19.3.0, react-dom@19.3.0, react-email@6.11.0 (+@react-email/render@2.1.0, html-to-text via it), typescript@7.0.2, vitest@5.0.3, @playwright/test@1.63.0, oxlint@1.86.0, oxc-parser@0.152.0, pg@8.23.0, zod@4.6.5, better-auth@1.7.7; Node 22.22.0 local, Postgres 18.3 local.

## 13. The spike's recommended task breakdown
Order: outbox-core's tasks first (migration 007, queueing in transactions, drain, cron). The ones below build on them. One commit per task, each with the full gate.

1. **SMTP transport swap.**
   - Base it on outbox-core's `smtp.ts` and `send.ts`; it allows no-auth relays.
   - Bring over from this spike:
     - `test/helpers/smtp-sink.ts` and `test/types/smtp-sink-modules.d.ts`;
     - the sink tests in `email.test.ts`: STARTTLS, AUTH, Vietnamese subject, Message-ID, Reply-To, 550 permanent, EAUTH and refused connection retryable, 451 vs 554;
     - `redactEmails()` inside `describeEmailError`;
     - the `missing_smtp_config` rename in `auth-errors`;
     - the transport-import guard;
     - the README env table (SMTP_*, no RESEND_API_KEY).
   - Remove resend.
2. **Registry `email.*` keys and the render module.**
   - Files: `lib/email/events.ts`, `lib/server/email/booking/{format,render,sample}.ts`, `templates/booking.tsx`, the layout generalization, the `loadStringRows(db)` argument, and `groupPhoneSql`.
   - Unit tests: `render.test.ts`, with the F2 wording test made unconditional.
   - Reconcile the seam with outbox-core's `renderBookingEmail(event, locale, data)`. Recommended: the drain calls `renderBookingEmail(db, { event, reservationId, locale })` from this spike, which loads data, locale and strings. Otherwise it keeps its loader and calls `loadEmailStrings` + `buildBookingEmail`.
3. **Recipients and the shared inbox.**
   - `lib/server/email/recipients.ts` (the `reaches()` fragment, also used by outbox-core's `queueStaffNew` and `emailOverview`: keep ONE) and `lib/admin/notification-schemas.ts`.
   - The `/admin/settings/notifications` page, forms and actions; the nav item; the guard rows and `ADMIN_ONLY_ACTIONS`; the audit entity labels.
   - Integration tests for resolution, CRUD and audit.
4. **"Gửi email thử".**
   - Needs a ruling first: direct send (this spike) or a `staff.test` outbox row (outbox-core).
   - Then `test-email.ts`, `TestEmailForm`, the `email_failed` code and `emailFailureHint`.
5. **Email log and "Gửi lại".**
   - `lib/server/email/outbox-log.ts`, adapted to outbox-core's columns: the 'sending' status, LEFT JOIN for `staff.test`, and the failed count rule.
   - The `/admin/reservations/emails` page and `resendEmail` (`after()`, no `refresh()`); the SectionNav link; the email CSS.
   - Integration tests for paging, env scoping and requeue.
6. **The booking detail page's email section and the overview counts**, plus `e2e/admin-emails.spec.ts`. Add the E2E data-map row: Hải Vân Lounge at +40, fresh recipient addresses.
7. **README.** The user steps (SMTP account, SPF/DKIM/DMARC, the port check) and the E2E data map.

## 14. Risks and open questions
1. **NEEDS RULING: test-email path.** This spike sends directly through the gate and awaits the result. That is immediate feedback, keeps the test out of the overview's failed count, never retries a test for a day, and needs no nullable `reservation_id`. outbox-core queues a `staff.test` outbox row and drains it at once, which shows the test in the email log with `created_by`. Spec §10.4 lists "Gửi email thử" as a trigger of the sender. If outbox-core's choice wins, the screens need: LEFT JOIN reservations in the log, exclusion of `staff.test` from `countFailedEmails`, a label for `staff.test`, and no "Gửi lại" on test rows.
2. **NEEDS RULING: who clicked "Gửi lại" is not recorded anywhere.** Aligned with outbox-core: no `reservation_events` type and no CHECK change. If an audit trail is wanted, add `'email_requeued'` to `reservation_events` (and its changes keys `outbox_id` and `event` to the phase-10 anonymiser allowlist) or write `audit_log` entity `'email_outbox'`.
3. Semantics are aligned with outbox-core: "Gửi lại" on a failed row resets attempts to 0 (a new 7-send schedule over about 19 h) and reuses the same Message-ID. On a waiting row it just makes the row due now. Sent and skipped rows cannot be resent, and resending a sent guest email would be a new row: not built.
4. Guest emails fall back to the default language when the guest's locale is disabled (the task's rule). At launch A `vi` is disabled (migration 004), so a Vietnamese phone booking gets English emails until phase 8 enables vi, even though the registry already has the Vietnamese copy. This is phase-4 risk 21; the user may prefer "send in vi when the registry has full VI copy". Staff emails always use the recipient's locale.
5. `status_reason` is free text that staff type, often in Vietnamese, and it is quoted verbatim in the guest's decline or cancel email, which may be in English. The TransitionPanel (which outbox-core edits) should say "Lý do này sẽ được gửi cho khách" when "Báo khách" is ticked.
6. Reply-To is this spike's proposal: `staff.new` replies go to the guest's email, and guest emails reply to `site_settings.email`. Confirm with the restaurant team.
7. `site_settings.email` is both the `staff.new` fallback and, from phase 6/7, the footer's general email. Editing "Hộp thư chung" here will change the footer later, so the copy on the screen should say so then.
8. Exact ICU strings are pinned in tests ('Th 2, 5 thg 10, 2026', 'Thứ Hai, 5 tháng 10, 2026', '7:00 PM'). They were verified on Node 22.22 locally; CI runs Node 24, whose ICU could differ by a character. If CI goes red, loosen to contains-checks.
9. The `staff.new` admin link uses `appOrigin()` = `BETTER_AUTH_URL`, which still falls back silently to `http://localhost:3000` (phase-3 ledger, phase 5). Make it fail closed outside log mode before live.
10. Privacy choice: guest addresses are masked (`l•••@domain`) in the email log list and shown in full on the booking page, where the guest's details already show. Staff addresses are unmasked. `last_error` is redacted of addresses at write time (`describeEmailError`) and again at display.
11. Admin tables in general overflow on phones. `.a-table-scroll` was added only around the two email tables; the inbox and other tables still widen the page at 390 px (pre-existing).
12. The recipient language select offers every locale. Only en and vi have registry email copy; other languages fall back per key to English (`resolveStrings`), so emails are not broken, just mixed.
13. The retry schedule in the log page's lede is hard-coded text ('sau 1 phút, 5 phút…'). Derive it from `RETRY_DELAYS_MINUTES` once outbox-core's constant is final.
14. Is `staff.new` only for web bookings? Not decided here (an outbox-core concern). Spec §10.3 lists guest emails for staff-created bookings, and `staff.new` reads like web-only.
15. The overview's "nhà hàng chưa có người nhận" and the settings list count `booking_enabled` restaurants only. A disabled restaurant cannot receive web bookings.
16. Not covered by this spike: the cron route, vercel.ts versus vercel.json and its cron syntax, BotID, honeypot, the per-phone limit, consent and the policy page, and SEC-2 inbox search off the URL. Those belong to the outbox-core and anti-spam spikes.
17. Load: 3 builds were run (the brief suggested at most 2). The third verified the final UI and requeue changes before reporting.

## 15. Spec deviations proposed by the spike
1. §10.4 'Resend': replaced by traditional SMTP (nodemailer), as the user decided. The idempotency key `outbox:{id}` now only seeds a deterministic Message-ID (`<outbox-{id}@sending-domain>`). Delivery is at-least-once: a crash between the SMTP 250 and the 'sent' UPDATE re-sends after the lease ends, with the same Message-ID. The '24 h Resend key retention' reason for the retry window no longer applies; the schedule (1m/5m/15m/1h/6h/12h, 7 sends) is kept as is.
2. §5.2 lists `site_settings` under phase 6: phase 5 creates it early, with only `email` (seeded `fb@furamavietnam.com`), as the `staff.new` fallback store. Phase 6 adds its other columns with `ADD COLUMN IF NOT EXISTS`. outbox-core made the same decision.
3. §10.4 lists 'Gửi email thử' as a trigger of the sender: this spike sends the test directly through the same gate and SMTP transport, not through `email_outbox`. It is a proposal pending a ruling; outbox-core queues a `staff.test` row instead.
4. §7.4 'thao tác trên đặt bàn ghi vào reservation_events': 'Gửi lại' writes no `reservation_events` row, aligned with outbox-core's ruling that a send is not a booking change. The email row carries the history.
5. Guest email language: the reservation's locale only while that locale is enabled on the site, else the default language (the task's rule). Staff emails use the recipient's locale regardless.
6. The email log masks guest addresses in the list; spec §7.2 says nothing either way. Full addresses show on the booking page.
7. The overview's 'nhà hàng chưa có người nhận thông báo' counts only restaurants with `booking_enabled`.
8. `notification_recipients.events` is limited to `{'staff.new'}` by a CHECK; the spec's `events[]` is open.
9. Registry: besides `email.<event>.<field>`, shared labels live under `email.common.*` (`label_*`, `time_value`, `contact`, `footer_guest`, `footer_staff`), so translators edit 'Date'/'Ngày' once.
10. 'Gửi lại' also applies to waiting (queued) rows, making them due now; on failed rows it restarts the attempt count.

## 16. User steps
1. Provide an SMTP account for sending, then set these on Vercel per environment: `SMTP_HOST`, `SMTP_PORT` (587 = STARTTLS, recommended; or 465 = implicit TLS), `SMTP_SECURE` (true/false; leave it unset to follow the port), `SMTP_USER` and `SMTP_PASSWORD`.
2. Choose `EMAIL_FROM`, for example `'Furama Cuisine <no-reply@mail.furamavietnam.com>'`. Have IT Furama align SPF, DKIM and DMARC for that sending domain at the SMTP provider; check first whether the root domain already has a DMARC record.
3. Set the email gate per environment: Production gets `EMAIL_DELIVERY=live`. Preview gets `EMAIL_DELIVERY=redirect` plus `EMAIL_REDIRECT_TO=<a test inbox>`. Local and CI keep `log`.
4. Check that a Vercel function can reach the provider on 587 or 465 (port 25 is usually blocked): on the first preview, open `/admin/settings/notifications` and press 'Gửi email thử'. A connection error shows the Vietnamese hint 'Không kết nối được máy chủ SMTP…'.
5. Check the provider's sending limits (per hour and per day) against peak booking volume, because each booking may send to the guest plus every `staff.new` recipient.
6. Give the notification recipient emails per restaurant or per destination (spec §15 item 15), and confirm the shared inbox address (default `fb@furamavietnam.com`). It receives `staff.new` for restaurants with no recipient and guests' replies.
7. Decide the open rulings: the test-email path (direct or outbox row), Reply-To (staff replies go to the guest; guests reply to the shared inbox), and whether a Vietnamese guest gets Vietnamese emails while vi is still disabled on the site.
