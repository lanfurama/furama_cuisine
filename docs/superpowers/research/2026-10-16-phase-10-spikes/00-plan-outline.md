# Phase 10 plan outline: Gia cố → mốc ra mắt B

Scope: spec `docs/superpowers/specs/2026-10-01-admin-cms-design.md` §14.1 row 10 (`:773`): guest-site CSP; the data anonymiser cron; the contract migration (drop `restaurants.slot_capacity`, `type`, `destination`, `cuisines`, `meals`, the `SLOTS` constant and the content constants of `lib/data.ts`); deleting test data; a runbook and a staff guide. Acceptance: a security review, and the launch checklist walked end to end. Phase 10 also owns every item that earlier ledgers parked as "phase 10", the parts of spec §11 (security and personal data, `:693-723`), §12 (errors, `:725-737`) and §16 (risks, `:821-832`) that are still open, and the phase-4 rulings SEC-2 and SEC-3.

This file is an inventory and a proposed task order, written so the phase-10 plan (`docs/superpowers/plans/<date>-phase-10-hardening.md`, in the shape of plans 8 and 9) can be written from it. It proposes; the plan rules.

## 0. What I checked, and how

**State**
- Base: `origin/main` at `5657868`. I wrote only this file. I ran no build, test, server or migration, opened no database, and called no outside service.
- Phase 9 D8–D12 are being built in parallel. Their files (plan 9 `:1244-1583`): `app/api/admin/ai/**`, `app/api/cron/ai-jobs/route.ts`, `vercel.json`, `test/guards/vercel-crons.guard.test.ts`, `app/admin/(shell)/translations/page.tsx`, `lib/server/ai/**`, `README.md` (D12, the Google Cloud runbook) and the phase-9 ledger. D8 needs no migration (it uses `ai_jobs` from 012), so **016 is the next free number**. The tasks below leave `vercel.json` and the AI files alone, and §3 says when they touch `README.md`.
- Languages are code now: `lib/i18n/site-locales.ts:22-25` (en default, **vi already `enabled: true`**). There is no `locales` table (migration 011), so `reservations_consent_locale_fk` is gone (`011_drop_locales.sql:26`). No phase-10 item may assume a language screen.

**Sources read**
- The spec: §3 defaults (`:48-62`; `:58` "Ẩn danh dữ liệu khách sau 24 tháng"), §11, §12, §14.1 row 10, §16.
- `grep -rn -i "phase 10\|đợt 10"` over `docs/` and `README.md`: 157 lines. That covers the ledgers of phases 2, 3, 4, 5, 6, 7A, 7B and 8 (their "Phase 10" sections in full), plans 2–8, and the research of phases 2–7. The README has no "phase 10" line; I read its "Before launch A" (`:1258-1437`), "Before launch B" (`:1439-1472`) and the cron rows of "Routes" (`:1509-1510`).
- `docs/agency/agency-team-prompt.md` (branch `claude/pensive-noether-mlpxct`) §1–§3, §6, §8 and §9. Its P1 list of known phase-10 items is in the table below, item by item.
- In the code: `proxy.ts`, `next.config.ts`, `lib/admin/csp.ts`, `app/api/cron/*`, `vercel.json`, `test/guards/legacy-columns.guard.test.ts`, `lib/data.ts`, `db/client.ts`, migrations 001, 003, 006, 007, 010, 011 and 013, `lib/server/auth/config.ts`, `lib/server/client-ip.ts`, `lib/email/smtp-reply.ts`, and the readers of `is_test`, `anonymized_at`, `pii_retention_months` and `SLOTS`.

**Facts the proposals rest on**

| # | Fact | Where |
|---|---|---|
| F1 | No guest page sends a CSP or any security header. `next.config.ts` has `redirects()` and no `headers()`. The admin gets a nonce CSP plus `X-Frame-Options`, `Referrer-Policy`, `nosniff` and `Permissions-Policy` from the proxy. | `next.config.ts:36-41`; `proxy.ts:76-84`; `lib/admin/csp.ts:38-68` |
| F2 | The guest markup needs these in a static CSP: inline `style=""` (`Hero.tsx:69`, `Destinations.tsx:46-48`, `MobileBar.tsx:24`, `IntroCurtain.tsx:37`, `SearchOverlay.tsx:106`, `app/global-not-found.tsx:20`, and next/image's blur placeholder via `components/ui/CmsImage.tsx:23`); the inline `MOTION_BOOTSTRAP` script (`app/(site)/[lang]/layout.tsx:72`) and Next's inline flight scripts; the film iframe on `www.youtube-nocookie.com` / `player.vimeo.com` (`lib/media/film.ts:35`, `components/overlays/FilmModal.tsx:53-64`); and BotID, same-origin through the rewrite (`instrumentation-client.ts:13-15`, `next.config.ts:44-47`). Next documents the no-nonce CSP in `next.config` `headers()` (`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md:417-452`). Its experimental SRI does not cover inline scripts, so it cannot replace `'unsafe-inline'` here (same file `:456-540`). | as cited |
| F3 | `/api/cron/daily` only revalidates `content:offers`, and its comment says "no database". It is scheduled at `5 17 * * *`. | `app/api/cron/daily/route.ts:25-37`; `vercel.json:5` |
| F4 | The anonymiser's columns and hooks already exist. `reservations.anonymized_at`, `is_test`, `search_text` (006 `:218-220`). The trigger empties `search_text` once `anonymized_at` is set (006 `:267`). The email loader skips anonymised bookings (`lib/server/email/booking/load.ts:64`). `booking_settings.pii_retention_months` defaults to 24 and allows 1–120 (006 `:26`). The setting is saved (`lib/server/booking/config.ts:312`) and labelled "(tháng, từ đợt 10)" (`app/admin/(shell)/settings/booking/SettingsForm.tsx:40`). | as cited |
| F5 | `reservations.phone` is `NOT NULL` from 001 (`001_init.sql:26`), and `phone_e164` is `NOT NULL` from 003 (`003:35`). Spec §11 sets both to NULL (`:717`) and notes only the second (`:722`). `guest_name` is `NOT NULL` (`001:25`), which is fine for `'—'`. | as cited |
| F6 | SEC-3 contract (phase-4 ledger `:43-50`): strip `reservation_events.changes` by allowlist (keep `date`, `time`, `guests`, `over_capacity`, `source`, `note_id`); NULL `reservations.status_reason` and `reservation_events.reason`; a test that `/admin/audit` and the booking timeline show none of the dropped values. Phase-5 contract (outline `:361`, ledger "Đã chấp nhận" 14 in plan 5 `:294`): `email_outbox.to_email` becomes `'anonymized@invalid'` (passes the CHECK, `007:80-82`), and the **consent columns are kept**. Phase 8 (plan `:372`, ledger `:46`): if the anonymiser clears consent, it must clear `consent_version`, `consented_at` and `consent_locale` together. The two disagree; Q1. | as cited |
| F7 | `consent_locale`'s CHECK is still one-way (`consent_locale IS NULL OR consent_version IS NOT NULL`, `010:66-68`). Plan 8 `:300` leaves the two-way form to phase 10's contract step. | as cited |
| F8 | The privacy text promises 24 months as a fixed figure (`lib/i18n/registry.ts:625-626`, `legal.keep_body`), while staff may set anything from 1 to 120 (F4). Already flagged in phase-5 research (`anti-spam-consent.md:438`). | as cited |
| F9 | Production held **no bookings and no staff** at 009's apply on 2026-10-06 (`README.md:1289`), and the site has never been deployed. The anonymiser therefore has nothing to do on production until about 24 months after launch A. Only 006 sets `is_test`, and only for phase-1 rows (`006:246`). A booking made on a Preview lands in the production database unflagged (`README.md:1351-1356`, "Cancel test bookings made on a Preview"). | as cited |
| F10 | The `reservations: purge-test` permission exists (Admin only, `lib/server/auth/permissions.ts:18,39`). No action, screen or SQL uses it; the inbox only shows a "Test" tag (`app/admin/(shell)/reservations/page.tsx:100`). `test/integration/fk-coverage.test.ts:38` asserts that no path deletes a booking "before phase 10's retention". | as cited |
| F11 | Legacy columns: the guard bans reads of the five (`test/guards/legacy-columns.guard.test.ts:37`) and allows exactly one write, `UPDATE restaurants SET destination = NULL WHERE destination = $1` (`:47`, used at `lib/server/content-admin/destinations.ts:131` so that `restaurants_destination_fk` lets a destination go). The editing-screens map marks the five `LEGACY` (`lib/admin/content-screens.ts:183-187`). Tests read them on purpose: `test/integration/booking-seed.test.ts`, `catalogue.test.ts:37`, `content-seed.test.ts:122`, and `migration-004.test.ts`/`migration-006.test.ts` at their own stage. | as cited |
| F12 | `lib/data.ts` already lost its content constants in phase 6 (R1, plan 6 `:198`). What is left: `Meal`, `MEALS`, the `Restaurant` type, `FALLBACK_PHONE`, and `SLOTS` (`lib/data.ts:40-50`). `lib/data.test.ts:10` pins `['FALLBACK_PHONE','MEALS','SLOTS']`. | as cited |
| F13 | The `pg` pool has no `connectionTimeoutMillis` and no `statement_timeout` (`db/client.ts:41-45`). | as cited |
| F14 | Better Auth limits requests per IP and path, in the database (`lib/server/auth/config.ts:101-107`), using the first `X-Forwarded-For` hop (`lib/server/client-ip.ts:11-15`). `hooks.before` blocks only `/admin/*` (`config.ts:153-163`), so `/api/auth/update-user` is reachable from a browser. | as cited |
| F15 | Next is locked at 16.3.7 (`package-lock.json`, `node_modules/next`). The RSC-404 race spec is opt-in (`e2e/rsc-race.spec.ts:13`). | as cited |
| F16 | `public/assets` holds 76 files (9.6 MB). Migration 013 added new `media` rows under `/assets/…` (`013_official_photos.sql:21-23`), so the folder is still live content until the owner runs `scripts/move-assets-to-blob.mjs --apply` on production. | as cited |

**Items already closed** (I checked them, so the plan can drop them):
- The audit screen's empty `<nav>`: the pager renders only when there is a page to go to (`app/admin/(shell)/audit/page.tsx:74-80`).
- L10-5's guest-pages guard order: the guard now checks that `requireEnabledLocale` is the first await (`test/guards/guest-pages.guard.test.ts:54-71`).
- SEC-2's inbox search: it is a POST kept in a cookie, and the proxy strips `q` from `next` (`app/admin/(shell)/reservations/actions.ts:201-207`, `proxy.ts:68-70`).
- The content constants of `lib/data.ts`: removed in phase 6 (F12).
- SEC-3 (7A), "the consent version the guest saw": closed in phase 8 (C11).
- The phase-4 overview "đặt bàn hôm nay" mismatch: probably closed by `ca80b85` (one snapshot for the overview's counts). Re-check it in E10.

## 1. Inventory

Levels:
- **Blocker:** launch B cannot be declared without it (spec row 10, or a legal promise).
- **Should:** real risk or debt, cheap enough for this phase.
- **Could:** polish, or only relevant under a condition.

Proposal values:
- **làm:** do it.
- **không làm:** accept it, record why.
- **hỏi:** the owner decides (the numbers point to §5).

| ID | Item | Source | State in the code | Level | Proposal | Size | Depends on |
|---|---|---|---|---|---|---|---|
| P10-1 | Guest-site static CSP in `next.config.ts` `headers()` for every path except `/admin` (and `/api/admin`, which sets its own): `script-src 'self' 'unsafe-inline'`, `style-src 'self' 'unsafe-inline'`, `frame-src` for the two players, `img-src 'self' data: blob:` (plus the Blob host only if a raw Blob URL remains), `frame-ancestors 'none'`, `object-src 'none'`, `base-uri`, `form-action 'self'`. Add `nosniff`, `Referrer-Policy` and `Permissions-Policy`. Fold in T8.7 (inline styles on the guest error pages). | spec `:700-704`, `:773`; phase-4 ledger `:117`; phase-5 ledger `:129` (T8.7); phase-5 outline `:356` (BotID); 7A outline `:697-701`; 7A ledger `:70` (A9, risk 21) | None (F1, F2) | Blocker | làm (Q5: BotID Deep Analysis) | M | — |
| P10-2 | The anonymiser in `/api/cron/daily`: for bookings whose `reserved_on` is older than `pii_retention_months`, in batches, one transaction each. On `reservations`: `guest_name='—'`, NULL `phone`, `phone_e164`, `email`, `note`, `status_reason`, and set `anonymized_at` (the trigger then empties `search_text`). Delete `reservation_notes`. Strip `reservation_events.changes` by the allowlist and NULL `reason`. Set `email_outbox.to_email='anonymized@invalid'`. Consent per Q1. The SEC-3 test covers `audit_feed` and the timeline, and pairs with the phase-4 "audit_feed.after.changes no longer asserted" gap. | spec `:716-722`; phase-4 ledger `:43-50`, `:111` and the T7 line; phase-5 plan `:294`; phase-8 ledger `:46`; plan 8 `:372` | Columns, trigger and email skip exist (F4). The cron does nothing with them (F3). `phone`/`phone_e164` are NOT NULL (F5). | Blocker | làm (Q1, Q3) | L | P10-4 |
| P10-3 | One retention figure. The policy says 24 months and the setting allows 1–120. Either cap the setting at the policy's figure, or make `legal.keep_body` read the setting (a new policy version each time it changes). | spec §3 `:58`; F8 | Mismatch (F8) | Should | hỏi (Q2) | S | P10-2 |
| P10-4 | Migration 016, privacy part: `ALTER … DROP NOT NULL` on `reservations.phone` and `phone_e164` (or placeholders, Q3). The two-way `consent_locale` CHECK, with a backfill of `en` first as 010 did. An index on `email_outbox.reservation_event_id`, so the purge's cascade and `ON DELETE SET NULL` do not scan the table (T1.4). Optionally, a CHECK that an anonymised row holds no contact field. | spec `:722`; F5; F7; phase-5 ledger `:118` (T1.4) | Not done | Blocker | làm | S | Q1, Q3 |
| P10-5 | Migration 016, contract part: drop `restaurants.type`, `destination`, `cuisines`, `meals`, `slot_capacity` and `restaurants_destination_fk`. Remove the one allowed write (`destinations.ts:131`), `SLOTS` and its test pin, `booking-seed.test.ts`, the `LEGACY` markers, and the legacy reads in `catalogue.test.ts` and `content-seed.test.ts`. Replace the read guard with a schema assertion that the columns are gone (stricter, not looser), and update `.claude/architecture.md` Luật 7 and §6 in the same commit. | spec `:136`, `:773`; plan 6 `:11769`, `:1883-1887` (COMMENT ON COLUMN); plan 4 ledger risk 17 | Unread but present (F11, F12) | Blocker | làm | M | — |
| P10-6 | Delete test data: an Admin action under `reservations: purge-test`, on `/admin/settings/booking` or the inbox. It deletes `is_test` bookings in one transaction with one audit row (counts only, no guest data) and refuses on `VERCEL_ENV=preview` (Previews share the production database). Update `fk-coverage.test.ts:38`. | spec `:723`, `:773`; plan 4 risk 10 (outline `:705`) | Permission only (F10). No production rows are flagged today (F9). | Blocker | làm, scope per Q4 | M | P10-4 (index) |
| P10-7 | Flag bookings made on a Preview deployment as `is_test`, so P10-6 can clear them (today staff must cancel them by hand). | F9; `README.md:1356` | Not flagged | Should | hỏi (Q4) | S | P10-6 |
| P10-8 | Runbook: the launch-B checklist (the README's "Before launch A" steps that remain, "Before launch B", migration 016, the first-preview checks of P10-20, the WAF rules of P10-21), plus an incident page (DB down or Neon suspended, email failing, cron 401, rollback, rotating `CRON_SECRET`/`BETTER_AUTH_SECRET`/SMTP). | spec `:773`; agency prompt §3 P1 | README holds deploy and migration runbooks; no launch-B checklist, no incident page | Blocker | làm | M | E1–E7 |
| P10-9 | Staff guide in Vietnamese: sign in, the inbox and a booking's life, closures and hours, editing content and History, media, translations, what not to do on a Preview. | spec `:773` | None (`docs/` holds only `superpowers/`; README "Editing content" `:212` is for developers) | Blocker | làm, format per Q9 | M | E1–E7 |
| P10-10 | Security review and launch-B acceptance ("Kiểm tra bảo mật; đi hết checklist ra mắt"), then the phase-10 ledger. | spec `:773` | — | Blocker | làm | M | all |
| P10-11 | SEC-2 follow-through, the log review: no guest name, phone, email or note in any `console.*` line, URL or error code (spec §12 "Ghi log"). | spec `:737`; phase-4 ledger `:39` ("anonymiser, retention, log review") | Search is POST (closed). Logs not reviewed as a whole. | Should | làm | S | — |
| P10-12 | `/api/auth/update-user` lets staff change their own name and image with no audit row. Allowlist the HTTP auth paths in `hooks.before`. | phase-3 ledger `:87` | Open (F14) | Should | làm | S | — |
| P10-13 | The require-permission guard still accepts `return await <side effect>` in a catch. Tighten it to exactly `return actionError(<param>)` or `throw <param>`. | phase-3 ledger `:41`, `:77` | Partial: one statement enforced (`test/guards/require-permission.guard.test.ts:283-305`) | Should | làm | S–M | — |
| P10-14 | NUL bytes or invalid UTF-8 in guest fields raise Postgres 22021, which the guest sees as `error.network`. Refuse `\u0000` in the zod schemas. | phase-4 ledger `:115` | Open | Should | làm | S | — |
| P10-15 | A connection timeout and a `statement_timeout` on the pool (L10-2). | phase-6 ledger `:123` | Open (F13) | Should | làm | S | — |
| P10-16 | Fail closed when `VERCEL` is set and `VERCEL_ENV` is not: refuse `live` email and warn once. | phase-5 ledger `:141` | Open (`lib/server/email/mode.ts:15`) | Should | làm | S | — |
| P10-17 | SMTP reply parsing. A 5.7.x recipient-policy refusal is retried for about 19 h. `RECIPIENT_CODE` can match a `5.1.N` inside an IPv4 address (strip dotted quads, or anchor after the reply code). | phase-5 ledger `:57-58` | Open (`lib/email/smtp-reply.ts:23-25`) | Should | làm | S | — |
| P10-18 | `legal_versions` is append-only by convention only. Enforce it with a trigger or `REVOKE` in 016. | 7A ledger `:69` (A4, R21) | Open (009 has no guard) | Should | làm | S | E1 |
| P10-19 | DB-down hardening. Warm the affected guest pages in `after()` after an admin save, and set `maxDuration` on the detail page (spec §12). L10-1: every guest page expires a day after its last render, so an outage longer than a day breaks them all. | spec `:729`; phase-6 ledger `:122` (L10-1); plan 6 R8 `:205` | Not done (no warm-up code; `maxDuration` only on API routes) | Should | làm, after the first-preview evidence of P10-20 | M | P10-20 |
| P10-20 | Vercel-only checks on the first preview: `updateTag` reaching every instance, cron registration and timing, a DB outage right after a save, the real Blob service (CORS, overwrite refusal, public access), and sharp's memory. | spec §16 `:821-832`; phase-6 ledger `:125` (L10-4); 7A ledger "Needs a decision" | Not run (nothing deployed) | Should | chủ dự án / controller; checklist in P10-8 | S | launch A deploy |
| P10-21 | Junk-slug and proxy-skipped-path cache growth: each random `/:lang/restaurants/:x`, or an unknown locale-shaped top-level path (M8), adds an ISR entry. Use Vercel Firewall (WAF) rate-limit rules; the code cannot stop it (`dynamicParams` is unavailable with Cache Components). | plan 6 R13 `:210`; phase-6 ledger `:124` (L10-3); phase-2 ledger `:59` (M8) | No rule; the matcher skips locale-shaped paths (`proxy.ts:19-24`) | Should | chủ dự án sets the rules (Q7); runbook in P10-8 | S | — |
| P10-22 | The rate limit lives only in the HTTP router, and `X-Forwarded-For` is trusted. | phase-3 ledger `:30`, `:92` | As accepted (F14) | Could | không làm: true on Vercel, which sets XFF. Record it in the security review; revisit only if self-hosted. | S | — |
| P10-23 | Invite and reset tokens appear in URLs and logs. | phase-3 ledger `:32` | Single use, short expiry, hashed at rest, `Referrer-Policy: same-origin` (`lib/admin/csp.ts:62-64`) | Could | không làm: record it in the review. Option: carry the token in the fragment. | S | — |
| P10-24 | The admin and the guest site share one origin (the subdomain option). | phase-3 ledger `:33` | Shared. React escaping; no raw CMS HTML is rendered. | Could | hỏi (Q6); recommend not for launch B | L | — |
| P10-25 | Blob `preview/<branch>/` orphans are never swept. Also: the sweep has no time budget inside `maxDuration` (A7), `downloadBlob` accepts any public Blob host and does not cancel the body (A5), and a purge-then-failed-orphan-pass run is never retried (7B). | 7A ledger `:69-70`; 7B ledger `:99` | Open (`lib/server/media/sweep.ts`, production folder only) | Should | hỏi (Q8) for the folder; làm for A5/A7 | M | — |
| P10-26 | An `onUploadCompleted` fallback route outside `/api/admin`. | plan 7A R13 `:181`; 7A ledger `:61` | Not used (`app/api/admin/media/upload/route.ts:21`) | Could | không làm unless the first preview shows uploads that never register | M | P10-20 |
| P10-27 | A History pager, and paging for the trash (capped at 20). | 7A ledger `:61`; 7B ledger `:95` | `HISTORY_LIMIT = 30` (`lib/server/history/history.ts:23-32`); `listTrashed(limit = 20)` (`lib/server/media/library.ts:136`) | Could | hỏi (Q11) | M | — |
| P10-28 | A router-level unsaved-changes guard, and the inbox search results losing a conflict's alert. | 7A ledger `:61`; 7B ledger `:32`, `:100` | Open | Could | hỏi (Q11) | M | — |
| P10-29 | Re-measure the RSC-404 race on Next ≥ 16.4 (about 1 client navigation in 120 becomes a full load during sustained saving). | 7B ledger `:26`; phase-4 ledger `:26` | Next 16.3.7 (F15) | Could | only if Next is upgraded (Q12) | S | — |
| P10-30 | Staff `actor_label` is "Name (email)", so editors see colleagues' emails, and the email outlives a deleted account. | phase-4 ledger `:113` | `auditActor` (`lib/server/dal/session.ts:103-105`) | Could | hỏi (Q10) | S | — |
| P10-31 | Outbox and auth-email polish: one log line per reaped id (T4.3); `sendStaffInvitation`/`sendPasswordReset` made `async` (T2.2); `listGuestContacts` after commit can lose the call list on a DB error. | phase-5 ledger `:120`, `:123`, `:57` | Open | Could | làm with P10-17 | S | E2 (outbox file) |
| P10-32 | Small admin and auth fixes: `signOut` swallows errors without logging (`app/admin/(shell)/actions.ts:10-14`); a NULL role renders as "Admin"; create-admin's Ctrl-C message; accept-then-sign-in failure answers `db_error`. | phase-3 ledger `:42`, `:86-91` | Open | Could | làm with P10-12 | S | — |
| P10-33 | The session-first guard checks only awaited reads. | phase-4 ledger `:26` | Open | Could | làm with P10-13 | S | — |
| P10-34 | Test-hardening backlog: phase 3 (`:78-85`), phase 4 (T1–T13 gaps), phase 5 (T1.2, T1.3, T1.5, T2.3, T2.5, T6.4, T6.5, T9.3, T12.2, T12.6), phase 6 L10-5 (the locator and timeout parts) and L10-7, 7A (A1–A10 "Guards and tests"), and the 7B residuals (`:123-128`; lint at the 14-warning limit). | as cited | Open | Could | Only the tests that pin a phase-10 change go into the plan; the rest go to the agency's "Liên tục" stream | L | — |
| P10-35 | Admin and guest polish and performance: phase-4 sequential awaits, N+1 and the seated-booking date edit; phase-5 T7.3, T10.2 and the focus drop after REQUEST BOOKING; 7A A3, A8, A11; 7B UX-7, UX-8, B3–B10 wording; L10-6 (the card's call action is `location.assign('tel:…')`, `components/site/SiteProvider.tsx:597`). | as cited | Open | Could | the "Liên tục" stream, not launch B | L | — |
| P10-36 | Make the repository private, and rotate the database owner password flagged in the phase-8 ledger. | spec `:832`; phase-8 ledger `:61` (Q5) | Unknown to the code | Should | chủ dự án (Q16) | S | — |
| P10-37 | `vi` is enabled in code, while the Vietnamese privacy text awaits the lawyer, so Vietnamese bookings record the English version. | `lib/i18n/site-locales.ts:24`; phase-8 ledger `:50`, `:60`; README `:1439-1472` | vi on | Should | hỏi (Q14) | S | — |
| P10-38 | Remove the `/assets` originals from the repository once production serves Blob. | 7A outline `:736` | Still live content (F16) | Could | không làm now (Q15) | S | owner's `move-assets-to-blob --apply` |
| P10-39 | Data-subject requests (Law 91/2025/QH15): a staff action that anonymises one booking now, through the same code as P10-2. | spec `:714` (lawyer to confirm) | None | Could | hỏi (Q13) | S | P10-2 |

**Counts:** 39 items.
- Blocker: 8 (P10-1, 2, 4, 5, 6, 8, 9, 10).
- Should: 16 (P10-3, 7, 11–21, 25, 36, 37).
- Could: 15 (P10-22–24, 26–35, 38, 39).

The table holds every line of the agency prompt's P1 list: guest CSP (P10-1); SEC-2/SEC-3 with `consent_locale` (P10-2, P10-4, P10-11); legacy columns (P10-5); rate limit and XFF (P10-22); tokens in URLs (P10-23); shared origin (P10-24); the catch guard (P10-13); RSC-404 on ≥ 16.4 (P10-29); preview-folder orphans (P10-25); trash and History paging (P10-27); recipient-policy retries (P10-17); the search-results conflict alert (P10-28); M8 (P10-21).

## 2. Architecture notes for the plan

- **Anonymiser placement (Luật 1, Luật 5).** The job belongs to the booking lifecycle: `lib/server/booking/retention.ts`. But only `email/outbox.ts` may write `email_outbox`, and `booking` sits below `email`. So `booking` declares a port, for example `RetentionEffects = { anonymiseOutbox(client, reservationIds) }`. `email/outbox.ts` implements it. `app/api/cron/daily/route.ts` wires them, as `outboxEffects()` is wired today. The cron keeps its `revalidateTag` call, gains a DB step, and raises `maxDuration` (300, with a time budget per batch loop). Its schedule does not change, so `vercel.json` and the crons guard stay untouched, and phase 9 D8 keeps them to itself.
- **Purge placement.** `lib/server/booking/purge-test.ts` (transaction, one `insertAudit` row with counts). The action follows Luật 3 with `requirePermission({ reservations: ['purge-test'] })` first. The cascade to `email_outbox` (`007:77`) is a database `ON DELETE`, not an app write, so Luật 5 holds.
- **Readers of anonymised rows.** Once `phone`/`phone_e164` may be NULL, every reservation reader must handle NULL: the `queries.ts` types, the booking page, the inbox, email `load.ts`, and `affected.ts`. TypeScript only catches this if the row types change to `string | null`; the plan should change them in E2 and let typecheck list the readers.
- **Guest CSP builder.** A pure function next to the admin one (for example `lib/guest-csp.ts`, unit-tested). `next.config.ts` maps it in `headers()` with a `source` that excludes `/admin` and `/api/admin`. Two CSP headers on one response would both be enforced, so the exclusion is load-bearing; test it.
- **Guards.** P10-5 retires or narrows `legacy-columns`, and P10-13 tightens `require-permission`. Both change `.claude/architecture.md` §6 in the same commit (CLAUDE.md).

## 3. Proposed tasks (one PR each, in dependency order)

| Task | Content | Items | Size | Depends on | Touches (watch for conflicts) |
|---|---|---|---|---|---|
| **E1** | Migration 016 (privacy schema plus contract), `db/checks/preflight-016.sql` and `postcheck-016.sql`, `migration-016.test.ts`. Remove `SLOTS`, the seed test, the legacy markers and the one legacy write. Narrow the legacy guard, update architecture.md, and add README "### Migration 016". | P10-4, P10-5, P10-18 | M | Q1–Q3 answered (they shape the CHECKs) | `db/`, `lib/data.ts`, `lib/admin/content-screens.ts`, `lib/server/content-admin/destinations.ts`, tests, README (its own section) |
| **E2** | The anonymiser: `booking/retention.ts` with the port, the outbox implementation, the cron wiring with `?dry=1` (counts only), and the integration tests (no table holds a name, phone or email of an expired booking; `audit_feed` and the timeline are clean; batches; re-runs are no-ops). Make readers NULL-safe, change the settings label, update the README route row. | P10-2, P10-3 (per Q2) | L | E1 | `lib/server/booking/**`, `lib/server/email/outbox.ts`, `app/api/cron/daily/route.ts`, settings form |
| **E3** | Test-data purge (Admin), refused on Preview; optionally flag Preview bookings `is_test`. Update `fk-coverage`, add an E2E test. | P10-6, P10-7 | M | E1 | `lib/server/booking/purge-test.ts`, `create.ts` (if Q4 says yes), settings page |
| **E4** | Guest CSP and headers: the builder and its unit test, `next.config.ts` `headers()`, inline styles on the guest error pages, and an E2E listener that fails on any `securitypolicyviolation` (home, detail, drawer, search, film with a test URL, `/vi`, the 404 pages). A check that `/admin` carries exactly one CSP. | P10-1 | M | Q5 | `next.config.ts`, `lib/guest-csp.ts`, `app/global-not-found.tsx`, guest error pages |
| **E5** | Auth and action hardening: the `update-user` allowlist, the tighter catch guard, the session-first guard, and the small auth fixes. | P10-12, P10-13, P10-33, P10-32 | S–M | — | `lib/server/auth/config.ts`, `test/guards/require-permission.guard.test.ts`, `app/admin/(shell)/actions.ts`, users page, `scripts/create-admin.mjs` |
| **E6** | Input, DB and email hardening: NUL refusal, pool timeouts, fail-closed `VERCEL_ENV`, SMTP code parsing, the outbox reaper log and the async senders, and the log review. | P10-14, P10-15, P10-16, P10-17, P10-31, P10-11 | M | E2 merged (shares `outbox.ts`) | `lib/server/booking/input.ts` zod, `db/client.ts`, `lib/server/email/{mode,send,outbox}.ts`, `lib/email/smtp-reply.ts` |
| **E7** | Cache and DB-down hardening: the `after()` warm-up and the detail page's `maxDuration`, shaped by what the first preview shows; the WAF rule text for the owner. | P10-19, P10-21 (doc) | M | P10-20 evidence | `app/admin/**/actions.ts` save paths (cache plan), `app/(site)/[lang]/(guarded)/restaurants/[slug]/page.tsx` |
| **E8** (optional, per Q8 and Q11) | E8a: Blob sweep (A5, A7, retry, and the preview folder per Q8). E8b: the History pager and trash paging. E8c: the unsaved-changes guard. | P10-25, P10-27, P10-28 | M each | — | `lib/server/media/**`, `lib/server/history/**`, `_kit` |
| **E9** | Runbook and staff guide: the launch-B checklist, the incident page, the guide (per Q9). | P10-8, P10-9, P10-20 (checklist), P10-21 (steps) | M | E1–E7, and D12 merged (README) | `README.md`, `docs/…` |
| **E10** | Security review (`bao-mat`): spec §11, the accepted risks P10-22, 23 and 24 written down, P10-29 if Next was upgraded. Then launch-B acceptance and `docs/superpowers/ledgers/<date>-phase-10-ledger.md`. | P10-10 | M | all | ledger, README |

Under the agency's limit of 3 open PRs:
- E1, E4 and E5 can open together; they share no file.
- E2 follows E1. E3 and E6 follow E2.
- E7 waits for a deployed preview. E9 and E10 close the phase.
- P10-34 and P10-35 are not tasks. They feed the "Liên tục" stream.

## 4. Migrations and production steps

- **016** (name to suggest: `016_retention_and_contract.sql`) is the only migration planned:
  - expand: drop NOT NULL on `phone`/`phone_e164`, add the outbox index, add the `legal_versions` append-only guard;
  - tighten: backfill `consent_locale`, then the two-way CHECK, plus the optional anonymised-row CHECK;
  - contract: drop the five columns and `restaurants_destination_fk`.
  If Q2 chooses to cap `pii_retention_months`, its CHECK goes into 016 too; answer Q2 before E1. A 017 is needed only if an answer comes after 016 is applied.
- **Order on production** (the owner, README §6 of the agency prompt). Run `preflight-016.sql` read-only and expect every row `ok`. Checks:
  - `_migrations` holds 001–015;
  - no reservation would break the two-way CHECK after the backfill;
  - no row in `legal_versions` would be touched;
  - count `is_test` and Preview-made bookings for Q4.
  Then apply 016 with `scripts/migrate.mjs` on the direct URL, run `postcheck-016.sql`, and deploy E1 at once. Between the apply and the deploy, only "delete a destination" can fail, because the old code still runs `UPDATE restaurants SET destination = NULL`. That is admin-only and rare, the same deploy-window approach as 008. A Preview builds on production, so 016 must be on production before any branch with E1 is pushed (README `:1275-1281`).
- **Other production actions (owner only):**
  - Run the purge (E3) as an Admin once Q4 is answered.
  - Add the Vercel Firewall rules (E7/E9, Q7).
  - Run the first-preview checks (P10-20), putting back what they change.
  - Rotate the password and make the repository private (Q16).
  - Have the lawyer review the retention wording (Q1, Q2, Q13) and the Vietnamese policy (Q14).
  - Record macOS visual baselines if E4 changes guest DOM or styles (agency prompt §8: never from Linux).
- **Nothing in phase 10 runs a script against production.** The anonymiser runs only as Vercel Cron on Production, and will be a no-op there for about two years (F9).

## 5. Questions for the owner

1. **Consent on anonymised bookings:** keep `consent_version`, `consented_at` and `consent_locale` (the phase-5 contract; they prove consent and hold no personal data), or clear all three together (phase 8's alternative)? Recommendation: keep. The lawyer confirms.
2. **The retention figure:** the policy promises 24 months, but staff can set 1–120. Cap the setting at the policy's figure (recommended: a CHECK in 016 and a hint on the settings screen), or let the policy text read the setting (each change becomes a new policy version)?
3. **Anonymised contact fields:** NULL for `phone`/`phone_e164` (spec §11, needs DROP NOT NULL; recommended), or placeholder values? And is `guest_name = '—'` right for the admin screens?
4. **Test data:** production has no flagged rows today. Should bookings made on a Preview deployment be flagged `is_test` automatically, so the Admin purge clears them, or will staff keep cancelling them by hand? Is the purge screen still wanted if the answer is "by hand"?
5. **BotID Deep Analysis on or off** at launch (README "Before launch A" step 3)? With it on, the guest CSP may need `'wasm-unsafe-eval'`/`'unsafe-eval'`. That is tested on the first preview.
6. **Admin on its own subdomain** (for example `admin.<domain>`): it isolates cookies and origin, but changes `BETTER_AUTH_URL`, DNS and every emailed link. Recommendation: not for launch B; the guest CSP and React escaping cover the current risk.
7. **Vercel Firewall rules:** will you add rate-limit rules for `/:lang/restaurants/:slug` and unknown top-level paths (we write the exact rule text in the runbook)? What limit per IP is acceptable?
8. **Preview uploads:** sweep orphans in `preview/<branch>/` (keeping any file a `media` row names), or have Previews write into `production/` (it reverses the 2026-10-05 folder decision)?
9. **Staff guide:** where and in what form? Markdown in the repository (public), a PDF you keep, or help pages inside the admin? For Admin and Editor together, or one guide each?
10. **Timelines show "Name (email)"** of the staff member who acted, and editors see colleagues' emails. Keep it, or show the name only?
11. **History pager, trash paging and an unsaved-changes guard:** before launch B, or after (the "Liên tục" stream)?
12. **Upgrade Next.js beyond 16.3.7** before launch B (to re-measure the RSC-404 race), or stay on the tested version? Recommendation: stay, unless a security release requires it.
13. **Data-subject requests** (Law 91/2025/QH15): do you want a staff button that anonymises one booking at once, when a guest asks? The lawyer decides whether it is required.
14. **Vietnamese is already switched on in code** (`lib/i18n/site-locales.ts:24`), while the Vietnamese privacy text awaits the lawyer, so Vietnamese bookings record the English version. Launch A with `vi` on, or off until launch B?
15. **The `/assets` originals:** keep them in the repository until you have run `move-assets-to-blob --apply` on production and confirmed the site, then remove them in phase 10 or later?
16. **Owner security steps:** has the database owner password flagged on 2026-10-06 been rotated, and will the repository go private before launch B?
17. **"Đi hết checklist ra mắt":** may the launch-B checklist be the README's remaining "Before launch A" steps, plus "Before launch B", plus the phase-10 items above? Is there a checklist of your own to add?

## 6. Risks

1. **The anonymiser is silent on production for about two years** (F9). A bug surfaces only when the first bookings expire. Mitigations: integration tests on backdated rows, covering every table that holds guest data (`reservations`, `reservation_notes`, `reservation_events`, `email_outbox`, `audit_feed`); `?dry=1` with counts; one log line per run with counts only; and a schema test that fails when a new column is added to those tables without an anonymiser decision, the way the SEC-3 allowlist treats new keys.
2. **Dropping columns cannot be undone.** Only a backup restores them. Old migrations stay re-runnable only at their own stage. The migration tests that re-run 004 or 006 build their database up to that stage, so the plan must check each `migration-0NN.test.ts` set-up before E1. Neon's point-in-time restore is the rollback, which the runbook says.
3. **A strict CSP can break the guest site silently.** Risk points: BotID's challenge, the film players, next/image's blur, Next's inline scripts, and the Vercel toolbar on Previews (`vercel.live`; only cosmetic there). E4's E2E violation listener and a first-preview check, including a real phone for BotID, are the gate. A header that also lands on `/admin` would double the admin CSP.
4. **Previews share the production database.** Any manual test of the purge or the anonymiser on a Preview would change production data. Hence the purge refuses on `VERCEL_ENV=preview`, the cron runs on Production only, and the runbook says so.
5. **Readers assume non-null contact fields.** An anonymised booking with `phone = NULL` may crash an admin page or an email render that expects a string. E2 must change the row types and test an anonymised booking on every admin booking screen.
6. **Phase 9 runs in parallel.** `README.md` (D12) and `lib/server/email/**` are shared ground. E1 and E2 keep README edits to their own sections. E9 starts after D12 merges. `vercel.json` stays phase 9's.
7. **Neon Free.** The daily cron starts touching the database once a day (00:05 Da Nang), on top of the hourly outbox and phase 9's hourly AI-jobs cron. The extra wake-up is cheap, but the runbook should list it with the others.
8. **Legal dependencies can hold launch B.** Q1, Q2, Q13 and Q14, and the Vietnamese policy text, all wait on the lawyer. The plan should let code merge with the recommended defaults, and keep the switch to launch B behind the answers.
9. **The scope can creep.** About 40 % of the items are Could, and the test and polish backlogs alone are L. The plan should hold launch B to the Blocker and Should rows, and move the rest to the "Liên tục" stream explicitly.
