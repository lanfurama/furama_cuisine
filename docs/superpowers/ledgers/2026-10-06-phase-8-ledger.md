# Phase 8 ledger — languages (spec §8, §14.1 row 8)

Plan: `docs/superpowers/plans/2026-10-06-phase-8-i18n.md` (tasks C1–C12; each task's "Đã làm" note records where the work differs from the plan). Spec: `docs/superpowers/specs/2026-10-01-admin-cms-design.md` §6.1, §7, §8, §13, §14.1 row 8. Phase 8 adds migration 010, applied to the production database on 2026-10-06 (README "Migration 010"), before the first phase-8 code reached `main`.

Acceptance closed by phase 8 (spec §14.1 row 8):
- **"Thêm `ko` không cần deploy".** `e2e/i18n-acceptance.serial.spec.ts`, on one build made while only English was on: an Admin adds Korean; its guest emails (one key edited on the emails screen in Korean), an offer's title in its KO tab and a UI string in Korean; "Xem trước" shows `/ko` to staff with the bar and `noindex`; turned on, a guest gets `/ko` (200, `lang="ko"`, the Hangul font, Korean where translated and English elsewhere, the switcher's KO), `/ko/restaurants/taya-house` (a path `generateStaticParams` never listed: plan risk 1 holds), the sitemap and hreflang, and the proxy's `Accept-Language: ko` redirect within its one-minute TTL; turned off, all of it goes; deleted, its rows go.
- **"`/vi` hiện bản đã duyệt và lấy EN cho chỗ thiếu".** `e2e/i18n.serial.spec.ts`: a Vietnamese save in a form's VI tab shows on `/vi` and an English edit marks it "EN đã đổi" (C8); a machine translation stays off `/vi` until an Editor approves it on `/admin/translations` (C10); a strings screen edits one language (C9); a booking on `/vi` keeps Vietnamese, its consent and its emails (C11).
- **Spec §8, the Admin's four steps** (add, coverage, preview, enable) run in the admin alone; the AI button is phase 9 (R8-13).
- **No language that is off ever reaches a guest:** C6's preview test and the acceptance's step 11.
- **The longest language:** `e2e/i18n-overflow.serial.spec.ts` stretches every UI word and menu label to 1.3 times English (a test language, German) and checks in code, on a phone and a desktop, that nothing in the header, the menus or the cards overflows that does not in English. It found one: a card's tag (`.rcard-tag`, `nowrap`) was clipped by the card's frame; every tag now wraps inside the card (English unchanged: it fits on one line).

Final gate (C12): see "Final gate" at the end.

## Rulings

R8-1 … R8-13 (plan "Rulings") stand as written, with these outcomes:
- **R8-3 (CJK fonts):** not `next/font/google`. Its CSS is linked from every page (about 700 `@font-face`, 520 KB on `/en`). `scripts/fetch-script-fonts.mjs` writes Noto Sans KR, SC and JP into `public/fonts/` at build time, and a page links its script's stylesheet only (`lib/fonts/scripts.ts`); `check-prerender.mjs` holds `/en` free of them (C3).
- **R8-4:** an item's token stays one across languages (7A's R2).
- **R8-6:** a language is turned on only when every guest email key has a text in it (a reviewed row, or the registry's own); Vietnamese passes on the registry's.
- **R8-7:** policy versions per language (migration 010: `legal_versions (locale, version)`, `reservations.consent_locale`); an English save versions every language that reads the English text of a changed key; a booking records the version and language its page showed (SEC-3).
- **R8-8:** English dates day first and a 24-hour clock, on the site and in the emails (`en-GB`).
- **R8-9:** `siteOrigin()` is `SITE_URL`, else `VERCEL_PROJECT_PRODUCTION_URL`, else localhost.
- **R8-11 (Draft Mode):** read inside a `'use cache'` function (`lib/server/draft-mode.ts`), so `/en`, Tàya House and the policy page stay fully prerendered (C6). In Draft Mode Next stores no cache entry, so a staff preview's second prerender pass misses `getEnabledLocales()` and logs "Unexpected cache miss after cache warming phase"; Next turns that call into a dynamic hole. Staff previews only; guest pages never log it (checked with `NEXT_PRIVATE_DEBUG_CACHE=1`).
- **R8-12:** guest search keeps Korean, Chinese and Japanese runs as written (NFC), and stays `fold_search()`'s twin elsewhere (NFKC would split it from SQL on Latin-1: `migration-006` test).
- **R8-13:** no "Dịch từ EN"; `/admin/translations` shows the bulk AI button disabled ("Có từ đợt 9").
- Implementation notes beyond the rulings: variable kinds are checked for translations only (an English editor may write `{count}` where the default had `{count, plural, …}`, as the 7B checklist does); closure reasons appear in coverage and the queue but are reviewed on their own screen (schedule permission); Draft Mode's exit route is `/api/preview/exit`, outside `/api/admin` (C6).

## Closed in 8

| Item | Where |
|---|---|
| Phase 2: `localeHref` unrooted and `?`/`#` paths, `Accept-Language` q > 1, upper-case locale prefixes, 404 pages that link to English | C2 (`e683aea`), C4 (`dde6e21`) |
| Phase 4: `locale ?? 'en'` in the submit path; `{phone}` context of `booking.no_dates`; `booking.day_past` "keep short"; `writeReasons` deleting every reason; the closure card's EN-only reason | C11 (`1b2a055`), C8 (`fa09617`) |
| Phase 5: GUX-5 (R8-8), T5.2 (`ownCopy`), T5.4 (context date examples), T8.3 (policy per language), R10 for a language enabled later (R8-6) | C11, C9 (`7815414`), C7 (`b290ffc`) |
| Phase 6: L8-1 (story link fallback), L8-2 (one cuisine label fallback), L8-3 (`intlSafe` via `supportedLocalesOf`), L8-4 (the inbox test's cleanup), L8-5 (call-tag context, wrapping tags) | C11 |
| Phase 6: L8-6 (deleting a language: the trigger on `social_links.visible_locales`, the screen's refusals, never the default) | C1 (`abcc80d`), C7 |
| Phase 6: L8-7 (`/sitemap.xml`, `/robots.txt`), L8-8 (`requireEnabledLocale` in the policy page's metadata) | C5 (`7587d85`), C4 |
| 7A: SEC-3 (the consent version the guest saw); A3 (variable kinds, plain-template apostrophes, the dead `no_other`, `search.none`'s locale); A4 (the VI email preview of unsaved VI text) | C11, C9 |
| 7B: the social links' languages and their History (R39), the decorative share image's empty `og:image:alt`, canonical/hreflang/sitemap/robots, the switcher's seven LOCKED words (R35) | C7, C5, C4 |
| Plan 4 and 6: CJK search (R8-12), dates and prices per language, long translated labels | C11, C12 |

## Deferred, with the reason

- **"Dịch từ EN" and bulk translation:** phase 9 (Vertex AI, R8-13). Every `*_i18n.status` still defaults to `'reviewed'`: the AI writer must set `machine`/`ai` (L9-1).
- **Changing the default language:** out of scope (the registry's default text is English; `DEFAULT_LOCALE` is a constant).
- **The anonymiser clears `consent_locale` with the rest:** phase 10, with SEC-2/SEC-3's anonymiser contract.
- **A no-JS shell for the soft 404 (R14):** accepted, as in phase 6.
- **`overflow-wrap` on the nav labels and chips:** not needed: the 1.3 times check finds nothing there at 375 and 1440 px. Their `nowrap` or fixed height would change English min-content sizing if touched.
- **Visual baselines for a translated page:** the visual suite's baselines are macOS renderings (`playwright.visual.config.ts`); this container cannot record them. The overflow check above is the code-level gate; the owner records `/de`-style screenshots with the next macOS baseline update.
- **A Vietnamese policy text:** none is saved; until the lawyer reviews one (README "Before launch B", step 3), Vietnamese bookings record the English version, and say so (`consent_locale = 'en'`).
- **Coverage on `/admin/locales`:** the dashboard and `/admin/translations` show it; the locales screen links there instead of repeating it.

## Needs a decision (owner)

| # | Question | Default while unanswered |
|---|---|---|
| 1 | Domain production cho `SITE_URL`? | `VERCEL_PROJECT_PRODUCTION_URL` |
| 2 | Bớt hoặc thêm ngôn ngữ trong danh mục (`lib/i18n/catalog.ts`, 13 ngôn ngữ)? | 13 như C2 |
| 3 | Bản dịch `vi` cho ra mắt B: người dịch, hay AI đợt 9 rồi người duyệt? | Không chặn đợt 8 |
| 4 | Văn bản chính sách tiếng Việt do luật sư duyệt trước khi bật `vi`? | Có (README "Before launch B") |
| 5 | Đổi mật khẩu `neondb_owner` của Neon (đã lộ trong chat ngày 2026-10-06)? | Cần làm ngay |
| 6 | Ghi lại ảnh mốc visual macOS (`home.png`, `taya-house.png`) sau C11 và C12? | Chủ dự án làm trên máy Mac |

## Final gate

Run locally on 2026-10-06 (Node 22, Postgres 16; CI runs Postgres 18):
- typecheck clean; lint exit 0 with 14 warnings (unchanged since 7B).
- Unit and integration: 137 files, 1684 tests; 2 fail only on the local Postgres 16 (`migration-008`'s two ON DELETE RESTRICT messages) and pass on CI's Postgres 18, as before phase 8.
- `Applied 10 migration(s).`; build and `check-prerender.mjs` pass (every guest page now also carries `content:legal`; the script fonts linked from no English page).
- E2E: 245 passed, 2 skipped (the opt-in BotID and RSC-race specs), on one build made while only English was on.
- Visual: not run here (macOS baselines; see "Deferred").
- Fixed on the way: the first visit to an impossible restaurant slug caches its 404 after answering, so on a server that has just started the second visit could still get the soft 200; `e2e/routing.spec.ts` now waits for the cached 404, then checks it stays.

Commits on `main`: `abcc80d` (C1), `8bd885e` (010 on production), `e683aea` (C2), `3224a9e` (C3), `dde6e21` (C4), `7587d85` (C5), `32da714` (C6), `b290ffc` (C7), `f61edd4` and `fa09617` (C8), `7815414` (C9–C10), `1b2a055` (C11), and C12's commit with this ledger.
