# Phase 6 plan outline: Chuyển nội dung vào DB

Scope: spec `docs/superpowers/specs/2026-10-01-admin-cms-design.md` §14.1 row 6: every content and translation table; `sections`, `site_settings`, `media` (pointing at `/assets`); a seed from `lib/data.ts`; the guest site reads from the DB; the detail page reads from the DB and opens for every restaurant with `has_detail_page`; the FK `reservations.offer_id`; the booking form sends `offerId`. **Acceptance:** the site is identical to before (screenshot comparison: visual 8/8 at `maxDiffPixelRatio 0`, never `--update-snapshots`); switching `has_detail_page` on for another restaurant makes its page work. Details in §5.1, §5.2, §6.1–6.5, §8, §12, §13. Phase 6 has **no editing screens** (phase 7) and stores **EN only** (translations are phase 8).

Folder: `/Users/bcmac/Desktop/projects/Outside Projects/furama_cuisine/docs/superpowers/research/2026-10-03-phase-6-spikes/`. It holds this outline and three spike reports:
- `schema-seed.md` (clone `p6-schema`, patch `p6sch-phase6-schema.patch`, 9 new files): migration 008 and its seed, the media generator, the frozen content fixture, the migration and seed tests, the Neon pre-flight and post-check SQL, the full inventory map (content-inventory §2.1–2.19 → table, column or registry key) and the `lib/data.ts` deletion plan.
- `read-path.md` (clone `p6-read`, commit `30ea85b`, patch `p6-read.patch`, 77 files): the whole guest site from the DB, pixel-identical; `sql.ts`, `lib/cache-plan.ts`, the loaders; the phase-5 `site_settings` handoff; the daily cron; measurements of the DB-down behaviour, the phase-4 RSC 404 race and random slugs.
- `detail-offers.md` (clone `p6-detail`, patch `p6dt-out/p6-detail.patch`, 64 files): the generic detail page and its acceptance spec, offers with date windows, `offerId`, search and filters from the DB, "Gọi để đặt bàn".

Clones and patches live under `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/`. Where a report and this outline disagree, **this outline wins**. §0 lists every conflict and how it was settled.

## 0. What I checked myself, on top of the three reports

**State**
- I wrote only this folder in the main repo. I ran no build, test or server, created no database, and touched no port. All three clones' databases were dropped and their ports freed by the spikes.
- `main` is at `4f67931`, a docs-only commit (`docs/superpowers/ledgers/2026-10-03-phase-5-ledger.md`) on top of `8fe98f5`, the base of all three spikes. The schema patch applies cleanly to `4f67931` (`git apply --check`); the read and detail patches touch no file that `4f67931` changed.
- The phase-5 deferral file named in the brief, `.superpowers/sdd/2026-10-02-phase-5-email-anti-spam/final-deferred.md`, is not in the repo (`.superpowers/sdd/` holds only a `.gitignore`). Its "Phase 6" items are in the committed phase-5 ledger §"Phase 6: content to DB" (lines 77–85): T6.2, T6.8, the `saveSharedInbox`/privacy handoff, the Dining House `+84`. I used that.
- I read: the spec (§1–§3, §5, §6, §7.2–7.5, §8, §11–§16), the phase-2, -4 and -5 ledgers (the phase-3 ledger has no phase-6 item), the phase-2 plan's risk list (lines 225–246), the phase-5 plan's Global Constraints (lines 27–188), the README's deploy and migration sections, `lib/data.ts`, `db/queries.ts`, `lib/cache-tags.ts`, `lib/i18n/registry.ts`, `lib/server/content/*`, the detail page and guarded layout, `Offers.tsx`, `SiteProvider.openReserve`, migrations 001/004/005/006/007, `check-prerender.mjs`, `vercel.json`, `.github/workflows/ci.yml`, the Next docs cited below, and the three patches' file lists, `cache-plan.ts`, `check-prerender` diff, CSS diffs and the 008 check SQL.

**Facts the decisions rest on**

| # | Fact | Where |
|---|---|---|
| F1 | Every list table since phase 3 uses `bigint GENERATED ALWAYS AS IDENTITY`. `reservations.offer_id` is a bare `bigint` with no FK. | `005:81,103`; `006:50,95,303,335`; `007:34,70`; `006:209` |
| F2 | `restaurants.updated_at/updated_by` exist (006); `destinations` has `card_image_id uuid` with no FK, the phone pair CHECK and `show_in_footer`; Dining House is `'+84859555759'` / `'0859 555 759'`. `reservations.restaurant_id REFERENCES restaurants (id)` with no action, so a restaurant with bookings cannot be deleted. | `006:37-44`; `004:64-91`; `001:21` |
| F3 | SQL readers of the phase-1 columns: `db/queries.ts:25`; `lib/server/booking/rules.ts:56,89,104`; `lib/server/booking/config.ts:389`; `lib/server/email/recipients.ts:39`. `test/integration/booking-seed.test.ts` reads them on purpose (phase 10). | grep at `4f67931` |
| F4 | `lib/data.ts` is imported by 3 admin pages (`DESTS`/`DEST_KEYS` in closures, restaurants, notifications), 20 guest components/pages, `lib/booking-errors.ts` (`CONTACT` → `DEFAULT_PHONE`), `error.tsx`, `global-error.tsx`, the privacy page, and `db/queries.ts`. | grep at `4f67931` |
| F5 | `ADMIN_SCREENS` has 8 screens (hero, booking, navigation, contact, seo, legal, emails, ui-text); the registry holds `error.*`, `booking.*`, `email.*`, `legal.*` only. All section copy and most UI text is inline JSX. | `lib/i18n/registry.ts:8-17` |
| F6 | `loadStringRows` does not filter `locales.is_enabled`: the proxy and the guarded layout gate the language. Spec §6.1: Draft Mode must render a disabled language (phase 8). | `lib/server/content/strings.queries.ts`; spec §6.1 "Xem trước" |
| F7 | Next 16.3.7: `dynamicParams` is not available with Cache Components (`03-file-conventions/02-route-segment-config/dynamicParams.md:22`); an empty `generateStaticParams` is an error, unknown params render on request, use `notFound()` (`02-guides/migrating-to-cache-components.md:570,606-612`); `revalidateTag(tag,'max')` serves stale while revalidating, `{expire:0}` blocks (`04-functions/revalidateTag.md:21-26`); `updateTag` expires at once (`updateTag.md:16`); `hours` = stale 5 min / revalidate 1 h / expire 1 day (`cacheLife.md:144`), still prerendered (`cacheLife.md:266`); without a coordinating cache handler, on-demand revalidation reaches only the instance that got the call (`02-guides/how-revalidation-works.md:74`). | `node_modules/next/dist/docs/01-app/…` (re-read) |
| F8 | CI runs on Node 24 and runs unit/integration tests and the build; visual runs locally only (Node 22.22). The 8 baselines are `e2e/__visual__/{desktop,phone}/{home,taya-house,nojs-home,nojs-taya-house}.png`; the drawer is in none of them. | `.github/workflows/ci.yml:34-56`; `playwright.visual.config.ts` |
| F9 | `vercel.json` holds one cron (`/api/cron/outbox`, `*/5 * * * *`). `check-prerender.mjs` checks `/en`, the Tàya page and `/en/privacy` for lifetime `max` and the tags `restaurants, i18n:en, locales, content:ui` (+ `content:legal` on privacy). | `vercel.json`; `scripts/check-prerender.mjs:31-38` |
| F10 | `Offers.tsx` shows VIEW OFFER only while the offer's restaurant is bookable and calls `openReserve({restaurant}, offer.note)`; `openReserve` pre-fills the note only when it is empty. `booking-switch.serial.spec.ts` asserts the VIEW OFFER count (1 with Tàya and Hải Vân off, 3 after). | `components/home/Offers.tsx:36-54`; `SiteProvider.tsx:516-535`; `e2e/booking-switch.serial.spec.ts:43,88` |
| F11 | Migration 007 is on Neon (2026-10-03). The 008 pre-flight expects exactly 001–007. | phase-5 ledger "Launch-A owner steps" 1 |
| F12 | Spec §14.1 row 7 owns "chữ giao diện", the editors, "test CI không tìm thấy chữ khách nhìn thấy nằm ngoài registry hoặc DB" and "sửa rồi xóa một ưu đãi, khôi phục được cả hai lần"; row 10 owns dropping the phase-1 columns and "các hằng nội dung trong lib/data.ts". Spec §7.5: restore re-inserts the main row and its `*_i18n` rows from the `audit_log` snapshot. | spec §14.1, §7.5 |
| F13 | Phase-2 plan numbering: **ruling 7** = an expired static route answers a raw 500 while the DB is down; **ruling 8 / risk 8** = random `/en/restaurants/<x>` add ISR entries; **risk 9** = `cuisineSlug` throws on an unknown label; **risk 7** = `/zz/restaurants/taya-house` 404 carries Tàya metadata (phase 8). The phase-2 ledger defers M4 (empty no-JS shell for unknown restaurants) "by phase 6" and M7 (soft-404 title) "phase 6 with the data-driven detail page". | phase-2 plan:225-246; phase-2 ledger "Final" |
| F14 | Phase-4 ledger §"Phase 6": `ORDER BY r.sort_order` without `r.id`; no test for a null `groupPhone`; "no open day and no group phone → the drawer says nothing" and the SearchOverlay dead click (risk 8, "Gọi để đặt bàn"); residual: guest RSC 404 `x-nextjs-postponed` during `updateTag('restaurants')` → investigate in phase 6. | phase-4 ledger:13,26,75-82 |

**Conflicts between the spikes, and the decision for each**

| # | Conflict | Decision | Evidence |
|---|---|---|---|
| C1 | Three 008 files: schema `008_content.sql`, read `008_content.sql` (different text), detail `008_content_restaurants_offers.sql`. | **Schema's `008_content.sql`** as the base, plus C3 and C7. | schema: 18 migration tests, 13 seed tests, 19 mutations, old code green on it |
| C2 | Identity: `GENERATED ALWAYS` + `OVERRIDING SYSTEM VALUE` (schema) vs `BY DEFAULT` (read). | `ALWAYS` (F1). Phase-7 restore re-inserts with `OVERRIDING SYSTEM VALUE`. | F1 |
| C3 | Re-run safety: schema `ON CONFLICT DO NOTHING` + per-row guards (and its own risk 14: a re-run resurrects deleted seeded rows); read seeds a list only while empty, translations join the parent. | **Both.** Every list seed gets `WHERE NOT EXISTS (SELECT 1 FROM <table>)`; every `*_i18n` seed joins its parent; schema's per-row guards stay; `media` keeps `ON CONFLICT (pathname)`. | read error 2 (deleted offer came back) |
| C4 | Media keys: schema `UNIQUE (pathname)`, `url = pathname = /assets/…`; read partial unique `url` for static; detail `url UNIQUE`, `pathname = substr(url,2)`. | Schema's (spec §11: `registerMedia` upserts by `pathname`). | spec §11 |
| C5 | Decorative set: schema 19 files (exactly the `alt=""` images); detail cuisine chips only. | Schema's. | schema mutation M2 + its decorative-set test |
| C6 | `reservations.offer_id` on delete: SET NULL (schema, read) vs RESTRICT (detail). | **SET NULL** (R5). | spec §3 item 1 (editors delete), F12 |
| C7 | `offers.restaurant_id` on delete: CASCADE (schema) vs RESTRICT (detail). | **RESTRICT** (R6). | F2, F12 |
| C8 | `offers.valid_until`: NULL (schema) vs `2026-12-31` (read, detail). | **NULL** (R4). | schema decision 7 |
| C9 | Phase-1 columns: switch every reader + nullable + guard test (schema) vs a `restaurants_sync_destination` trigger (detail). | **Switch + guard, no trigger** (R10). | F3 |
| C10 | Translation SQL: read's `LOCALE_CTE`/`i18nJoin`/`tr` (no `is_enabled`) vs detail's `localeCtes` (requires `is_enabled`, `NULLIF(…,'')`). | **Read's** (R16). Blank values are impossible (CHECK), so `NULLIF` is moot. | F6 |
| C11 | `offerId`: read = soft (restaurant only, never refused, prefill kept); detail = strict (`offer_unavailable`, drawer tag, prefill dropped, staff-email row, admin row). | **Soft link with a full check in the subselect** (R9); no new UI; email/admin display → phase 7. | F8 (drawer not in baselines, but "identical" is the acceptance), F10 |
| C12 | Daily cron: both implemented `{expire:0}` (spec); read measured and recommends `'max'`. | **`'max'`** (R7). | read §5 table rows C, E, F |
| C13 | Section copy / UI text as registry keys: phase 6 (schema T4) vs phase 7 (read, detail). | **Phase 7** (R2); the schema report's §2 map is phase 7's key list. | F5, F12 |
| C14 | `DESTS`: delete in phase 6 incl. admin (schema) vs keep for admin (read, detail). | **Delete**; the 3 admin pages read destination names from the DB (R1). | F4 |
| C15 | Detail components: read keeps `TayaHero`/`TayaExperiences` with props; detail renames to `RestaurantHero`/`Highlights`, `MoreRestaurants({slug, destinationName})`, `MobileBar({detail})`. | **Detail's** (spec §6.3 item 1: no Tàya-specific code), keeping the `restaurants.find((r) => r.slug === slug)` the page-scope fault injection needs (now in `MoreRestaurants`). | detail error 2 |
| C16 | Catalogue shape: read = `getRestaurants` + `getSiteContent` (6 cached parts, one per tag group); detail = one `getCatalogue`. | **Read's split loaders** (one tag group per entry, pinned by `cache-plan.test`), with detail's `Restaurant.phone` and `Restaurant.search`. | read `lib/cache-plan.ts` |
| C17 | Search: displayed text only (read) vs a server-folded string of page language + EN (detail). | **Detail's** (spec §6.3 item 9). | detail filters.spec +2 |
| C18 | Empty `generateStaticParams`: unhandled (read) vs `_none` placeholder (detail). | **`_none`** (F7). | `migrating-to-cache-components.md:570` |
| C19 | Acceptance restaurant: Danaksara (read) vs The Fan (detail). | **The Fan** (destination phone fallback, 2 highlights, MENU → `#dishes`, 3-column bar), plus read's "the card opens it without a reload" assertion. | detail §2.5; read §4 |
| C20 | "Gọi để đặt bàn": phase 7 (read) vs owner-gated phase-6 task (detail). | **Owner-gated phase-6 task**; the all-offline drawer message ships regardless (R20). | F14 |
| C21 | Names: `reservations_offer_id_fkey`/`reservations_offer_fk`; `restaurants_detail_image`/`restaurants_detail_needs_image`; `destinations_card_image_id_fkey`/`destinations_card_image_fk`; `numeric(14,2)`/`(12,2)`. | Schema's everywhere (§4.5). | — |
| C22 | Test counts differ (71/941, 73/951, 71/946) because scopes differ. | The plan drafter recomputes per task from the verified tree; §4.10 gives the baseline. | — |

## 1. Verified decisions

Each deliverable and acceptance criterion of §14.1 row 6, the approach, where it was verified, and the test that pins it.

| # | Item | Approach | Source | Pinned by |
|---|---|---|---|---|
| D1 | **All content and translation tables** | `db/migrations/008_content.sql`: 20 new tables + `restaurants`, `destinations`, `site_settings`, `reservations` extended; one transaction; expand only; every `*_i18n` carries the §5.1 item 3 columns; translatable text non-blank (NULL = fall back per field). | schema §1, §4, §5 | `migration-008.test.ts` (18 + C3/C7 tests): upgrade from 007 with a booking, counts, guards, re-run keeps edits and deletions, every CHECK/FK; mutation set R1–R9 |
| D2 | **`sections`** | 11 fixed keys, `is_visible` (restaurants always on), `image_id`, `link_url` (film: YouTube/Vimeo only). The home page omits a hidden section; a nav item hides with its section; film off also hides WATCH THE FILM. | schema §1.9; read §2.4 | migration CHECK tests; `content-loaders.test` (section hidden, nav follows) |
| D3 | **`site_settings`** | `ADD COLUMN IF NOT EXISTS` `default_restaurant_id` (seed taya-house, `ON DELETE SET NULL`), `default_occasion` (Dinner), `og_image_id`, `hero_autoplay_ms` (7000); DEFAULT-then-DROP DEFAULT seeding. One reader, `loadSiteSettings(db?)`, for the guest loader, the admin screen and the email Reply-To. | schema §1.11; read §2.8 | migration test; `shared-inbox.serial` E2E (mutation: no `updateTag(content:contact)` → red) |
| D4 | **`media` pointing at `/assets`** | 39 static rows (`url = pathname = /assets/<file>`), type/size/bytes from `scripts/measure-assets.mjs`; 19 decorative; 20 EN alts; `blur_data_url` NULL; RESTRICT from every content FK. | schema §1.6, §6 | `content-seed.test` re-measures every file, pins the decorative set and EXIF; `image-size.test` |
| D5 | **Seed from `lib/data.ts`** | Hand-written in 008, copying DB values where they exist (`type`, `name`, `cuisines`, `destination`); frozen fixture `test/fixtures/phase5-content.ts`. | schema §1.1–1.3, §7 | `content-seed.test` (13 tests; 10 seed mutations caught) |
| D6 | **The guest site reads from the DB** | `lib/server/content/*.queries.ts` (uncached SQL) + `site.ts`/`home.ts`/`restaurants.ts` (`'use cache'`, `cacheLife('max')`, offers `'hours'`, `cacheTag(...LOADERS.<name>.tags, TAGS.i18n(locale))`); text formatted on the server; `CmsImage` only where `next/image` was. | read §2 | `content-loaders.test` (loader output = fixture; fallbacks; unpublished hidden); `cache-plan.test`; `check-prerender` tags/lifetimes; visual 8/8 every task; negative control and DOM diff (A1) |
| D7 | **Detail page from the DB, for every `has_detail_page`** | `generateStaticParams` from `getDetailSlugs()` (or `['_none']`); `getRestaurantDetail` (`restaurants` + `content:destinations` + `media` + `restaurant:<id>`); `notFound()` unless published, not archived, page on; CALL/MAP restaurant → destination → hidden; MENU locale PDF → EN PDF → `#dishes` → hidden; highlights hidden at 0; "More at" hidden when alone; tab bar columns = visible buttons. | detail §2.4; read §2 | `content-loaders.test` detail cases; `restaurant-page.spec` (MENU opens the PDF without scrolling); A2 |
| D8 | **FK `reservations.offer_id`** | `reservations_offer_id_fkey → offers(id) ON DELETE SET NULL` + partial index `reservations_offer_idx`; 008 stops if any booking already has an `offer_id`. | schema §1.7 | migration test: unknown id refused, delete → NULL, pre-existing value → 008 fails, no `_migrations` row |
| D9 | **The booking form sends `offerId`** | VIEW OFFER → `openReserve(preset, {id, title})`; the submit carries `offerId` only while the chosen restaurant is the offer's; zod accepts an optional positive int and drops a malformed one; the insert stores the id only when the offer is that restaurant's, published, and its window covers `reserved_on`; never a refusal; the note prefill stays. | read §2.9 + R9 | `offer-booking` E2E (request body; aborted); `submit-reservation` integration (stored; other restaurant / unknown / unpublished / outside window → NULL, booking still made); `input.test` |
| D10 | **Offers by date** | `getOffers` `cacheLife('hours')`, window on `(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`; `/api/cron/daily` at `5 17 * * *` calls `revalidateTag('content:offers','max')` (R7); `/en` lifetime 3600/86400. | read §2.9, §5; detail §2.6 | `cron-daily.test` (401 cases, one `revalidateTag`, `no-store`); `offers-expiry.serial`; `check-prerender` LIFETIME |
| D11 | **Cache tags complete** (spec §6.2) | `lib/cache-plan.ts`: `CONTENT_TABLES`, `SAVE_TAGS`, `LOADERS`, `tagsForSave()`; loaders tag only through it. | read §3, §8 | `cache-plan.test` (every table a loader reads has a save tag that loader carries; every loader calls `cacheTag(...LOADERS.x.tags)`) |
| D12 | **Phase-1 columns no longer read** | Every reader on `destination_id`, `restaurant_cuisines`, `restaurant_i18n.type_label`, `service_periods`; `type`/`destination` nullable. | schema §3 | `test/guards/legacy-columns.guard.test.ts` |
| **A1** | **Site identical (screenshots)** | Pixel-neutral ordering (§3); natural-case nav + CSS uppercase; server formatting recipes; plain `<img>` kept. | read §1; detail §1 | Visual 8/8 at ratio 0 after every task. **T12:** negative control (DB edit → visual red), normalised server-DOM diff vs `8fe98f5` = exactly the 2 allowed differences (R18) |
| **A2** | **`has_detail_page` on for another restaurant → its page works** | Cached 404 and catalogue carry `restaurants`; a save that expires it (phase 6: the booking-rules form) brings the page up. | detail §2.5 | `restaurant-pages.serial.spec.ts` (The Fan: 404 → page with title, kicker, story, CALL from Dining House, 2 highlights, More at, MENU → `#dishes`, 3-column bar, card navigates client-side; back to 404 in `finally`). **Mutations (T12):** detail reader without `TAGS.restaurants` → red (proved, mut1); detail loader ignoring `has_detail_page` → red |

## 2. Spec deviations that need a ruling

Each ruling is proposed; each says what it costs if wrong.

1. **R1. Delete `lib/data.ts` content constants in phase 6, not phase 10** (spec §14.1 row 10). Delete everything in schema §3 marked "6", including `DESTS`/`DEST_KEYS` (the 3 admin pages read default-language destination names from the DB) and `CONTACT` (except the fallback phone). Keep `Meal`, `MEALS`, `MEAL_LABELS` (registry in phase 7), `SLOTS` (phase 10, read by `booking-seed.test`), the types, and `FALLBACK_PHONE` (`{display '+84 236 651 9999', tel '+842366519999'}`, permanent: `error.tsx`, `global-error.tsx` and `DEFAULT_PHONE` render without the DB; a test pins it to the resort destination's seeded phone). The frozen fixture keeps the equivalence proof. **If wrong:** none at runtime; a constant can be restored from git.
2. **R2. Section copy and UI text stay inline in phase 6; their registry keys, `ADMIN_SCREENS` additions and `CLIENT_KEYS` come in phase 7** (spec §14.1 row 7 owns "chữ giao diện" and the guard "no guest text outside the registry or the DB"). Phase 6 moves the `lib/data.ts` content and the rows of §5.2. Exception: **new** guest strings that phase 6 introduces go into the registry with `screen`, `vars`, `context` (`booking.all_offline`; R20's call label). **If wrong:** about 120 keys move in phase 6 instead of 7, with a pixel risk on every `t()` swap and no editor to use them.
3. **R3. `CmsImage` wraps `next/image` only where `next/image` is already used** (cuisine chips, restaurant cards, destination cards, stories, highlights; byte-identical DOM). The hero `<picture>`, chef, heritage, the restaurant portrait and the film poster stay plain `<img>` with the media URL: the optimizer would re-encode them. `CmsImage` gets a `decorative` prop (the film poster keeps `alt=""` by role). Spec §6.3 item 7 completes in phase 7 with the Blob move and re-taken baselines. **If wrong:** spec §6.3 item 7 is late by one phase; nothing user-visible.
4. **R4. Offers are seeded with `valid_from`/`valid_until` NULL**, though the section lede says "valid until 31 December 2026". Seeding the date would hide the offers on 2027-01-01 and turn the visual and E2E runs red from that day (no frozen clock). The owner sets real dates in the phase-7 editor. **If wrong:** the three offers keep showing after 31 Dec 2026 until someone sets the date; a one-row UPDATE.
5. **R5. `reservations_offer_id_fkey … ON DELETE SET NULL`**, with the partial index and 008's guard against pre-existing values. Editors may delete offers (spec §3 item 1); a booking keeps its date, time, party and its "Offer: <title>" note, losing only the link. Phase-7 restore (§7.5) re-creates the offer under the same id but does not re-link bookings. **If wrong:** links of deleted offers are lost; RESTRICT is a one-constraint swap.
6. **R6. `offers.restaurant_id … ON DELETE RESTRICT`.** Offers are edited on their own screen (`content/offers`); deleting a restaurant must not silently delete them (each deletion must land in `audit_log` so it can be restored). Restaurants are archived, not deleted, and one with bookings cannot be deleted anyway (F2). The restaurant's own rows (`restaurant_i18n`, `restaurant_cuisines`, `restaurant_highlights` + i18n) stay CASCADE: they are edited on the restaurant's screen and belong to its snapshot. **If wrong:** phase 7 deletes offers first; one constraint swap.
7. **R7. The daily cron calls `revalidateTag('content:offers', 'max')`, not `{ expire: 0 }`** (spec §6.2). Measured (read §5): with `expire:0` and the DB down at 00:05, `/en` answers a plain-text 500 to every visitor until the DB returns; with `'max'` it never fails. Cost: the first visitor after 00:05 sees yesterday's offers once (the next sees today's); with the DB down, stale offers until the hourly revalidate after recovery. An expired offer shown once cannot attach itself to a booking (R9 checks the window). On approval the controller amends spec §6.2 to read "Riêng cron ưu đãi hằng ngày dùng `'max'`: khách đầu tiên sau 00:05 có thể thấy bản cũ một lần, nhưng DB lỗi lúc đó không làm sập trang chủ". **If wrong:** one argument.
8. **R8. Phase-2 ruling 7 (DB down after an expiry) for admin saves: keep `updateTag`, accept the window.** The window needs the DB to fail between a save and the first visit to each expired page; it heals on its own. Measured: `/en` and `/en/privacy` answer a plain-text 500; the detail page streams `error.tsx` but never ends the response (upstream Next 16.3.7). Carry to phase 10: warm the affected pages in `after()` after the commit; `export const maxDuration` on the detail page; check both on the first preview. Spec §12's "error.tsx with the phone" holds only for streamed routes; note it in §12. **If wrong:** a guest sees a raw 500 during a DB outage that started right after a save.
9. **R9. `offerId` is a soft link.** Client: `openReserve(preset, offer?: {id, title})` keeps the note prefill; the booking state remembers `{offerId, restaurant}`; the submit sends `offerId` only while the chosen restaurant is the offer's. Server: zod `offerId` optional, a positive integer ≤ 2³¹−1, a malformed value dropped (`.catch(undefined)`), never an error code; the insert writes `offer_id = (SELECT o.id FROM offers o WHERE o.id = $n AND o.restaurant_id = $restaurant AND o.is_published AND (o.valid_from IS NULL OR o.valid_from <= $date) AND (o.valid_until IS NULL OR o.valid_until >= $date))`. No drawer tag, no `offer_unavailable`, no staff-email row, no admin row: those are phase 7 (admin booking screens, email editor). **If wrong:** staff see the offer only through the note until phase 7; a strict refusal is one code path and one registry key.
10. **R10. Every SQL reader leaves the phase-1 columns in phase 6; no sync trigger.** `rules.ts`, `config.ts`, `recipients.ts` (`reachesSql(…, 'r.destination_id')`), the admin restaurant options and the catalogue switch; 008 makes `type`/`destination` nullable (the values stay, so a rollback to phase-5 code still works). A guard test fails on `r.type`, `r.destination`, `r.cuisines`, `r.meals` or `slot_capacity` in app SQL. The booking path also refuses an unpublished or archived restaurant (`restaurant_unavailable`). **If wrong:** a missed reader shows up as a red guard, not a silent drop.
11. **R11. Seeds: fixed ids (`OVERRIDING SYSTEM VALUE`) + `ON CONFLICT DO NOTHING` + seed a list only while it is empty + translations join their parent + `setval(GREATEST(max, last_value))`.** Stricter than §5.1 item 7. **If wrong:** none (migrate.mjs never re-runs a file).
12. **R12. DB guards beyond the spec text:** `restaurants_detail_image` (a page needs its portrait; the acceptance spec sets one), `restaurants_published_card`, `nav_items` UNIQUE(target_section) and NOT IN (film, finder), media static/blob/dimension CHECKs, non-blank and length CHECKs on translatable text, https-only links, `offers_price_pair`/`offers_valid_range`, the `social_links.platform` enum (facebook, instagram, youtube, tiktok, zalo, x, tripadvisor, wechat, kakao, line), and `sections` without `sort_order`/`is_published` (not a list; spec §2: no page builder). **If wrong:** a later migration relaxes one CHECK.
13. **R13. Random slugs (phase-2 ruling 8): accept; rate limit in phase 10.** `dynamicParams` cannot be used (F7); `await connection()` made it worse (detail §4). Each random slug adds ~6 files / ~92 KB to the ISR cache and a 30-day cached 404 (carrying `restaurants`, so every catalogue save clears them). `generateStaticParams` returns `['_none']` when no restaurant has a page. **If wrong:** cache growth under a crawler until phase 10's WAF rule.
14. **R14. M7 (soft-404 title) and M4 (empty no-JS shell for unknown restaurants): accept, revisit in phase 8** with the i18n 404 work. `generateMetadata` returns "Page not found — Furama Cuisine" + noindex for an unknown slug and for a disabled language (closing phase-2 risk 7 early), but the first visit's server HTML still carries the home title. noindex is present everywhere, even for Googlebot. **If wrong:** cosmetic.
15. **R15. Phase-4 residual (guest RSC 404 `x-nextjs-postponed` during `updateTag('restaurants')`): accept.** Reproduced in both spikes (1 hard reload per 50–80 navigations at 6–8 expiries/s; 0 with `'max'`); the client falls back to a full load with correct content (`fetch-server-response.js:139-148`). Re-test on Next ≥16.4 and at phase 7's real save rates. **If wrong:** a guest occasionally gets a full reload during an admin save.
16. **R16. Loaders do not filter `locales.is_enabled`.** The proxy and the guarded layout gate languages; phase 8's Draft Mode must render a disabled language (F6). Closes the phase-2 Task 4/10 minor "loadStringRows lacks is_enabled" as by design. **If wrong:** one predicate in `LOCALE_CTE`.
17. **R17. `getSiteSettings()` takes no locale** (spec §6.2 says every reader takes one): nothing in `site_settings` is translated, so one entry serves every language. **If wrong:** one argument.
18. **R18. Two DOM differences are allowed, pixels identical:** the header nav labels are stored once in natural case and uppercased by `.hdr-nav .hdr-link { text-transform: uppercase }` (spec §6.3 item 6; `MENU_LABELS` goes); the Dining House footer link dials `tel:+84859555759` (E.164 from `destinations`) instead of `tel:0859555759`. The display "0859 555 759" stays until the owner answers (spec §15 item 14). **If wrong:** none; both are the spec's intent.
19. **R19. Restaurant card alt = a seeded copy of the restaurant's name.** The reader uses the media alt. Phase 7's restaurant editor must update the card's EN alt when a rename leaves it equal to the old name. **If wrong:** a stale alt after a rename.
20. **R20. "Gọi để đặt bàn" (phase-4 risk 8): ship the all-offline drawer message now; the card/search Call action is owner-gated.** Always: with no bookable restaurant, RESERVE opens the drawer on `booking.all_offline` ("Online booking is not available right now. Please call us on {phone} to book a table.", `DEFAULT_PHONE`) instead of "Checking tables…" forever. Owner-gated: a card or search result without a page whose restaurant books offline shows "Call {display} →" and dials the restaurant's, else the destination's number; with no number it stays inert (GX-6). **If wrong:** revert the card half; the drawer half is a bug fix.
21. **R21. Playwright `desktop-serial` runs with `workers: 1`** (`testProject.workers`, 1.63), and every serial spec that changes guest-visible data restores it through a path that expires the same tags (a save or the cron), never a bare SQL UPDATE. **If wrong:** none.
22. **R22. Phase-5 handoff closed in phase 6:** one reader of `site_settings` (T6.8); `saveInbox` calls `updateTag(TAGS.contentContact)` after the commit (spec §6.2 maps `site_settings` to `content:contact`); the privacy `{email}` from `getSiteSettings()`; the notifications sentence becomes "Đây cũng là email chung hiện ở chân trang web và trong trang chính sách bảo mật; lưu xong, web khách đổi theo ngay." (T6.2). **If wrong:** wording.

## 3. Tasks in execution order

All on `main`, one commit per task, each ending green: typecheck; lint exit 0 with 19 warnings; unit + integration; reset the E2E DB; build; `check-prerender`; E2E `--retries=0`; **visual 8/8 at ratio 0**. The order keeps the guest pixels unchanged at every step: the schema first (no app change), then readers with unchanged output, then the components section by section, each reading the same text from the DB.

**T1. Migration 008, its seed and its checks.**
- Lift from `p6sch-phase6-schema.patch`: `db/migrations/008_content.sql`, `scripts/measure-assets.mjs`, `lib/media/image-size.ts` (+ test), `test/fixtures/phase5-content.ts`, `test/integration/content-seed.test.ts`, `test/integration/migration-008.test.ts`, `db/checks/preflight-008.sql`, `db/checks/postcheck-008.sql`.
- Changes: C3 (`WHERE NOT EXISTS (SELECT 1 FROM <table>)` on every list seed, i18n seeds `JOIN` their parent); C7 (`offers.restaurant_id … ON DELETE RESTRICT`). Tests added: delete seeded offer 3 then re-apply → still 2 offers (read's case); deleting a restaurant that has an offer → RESTRICT.
- No app code changes. E2E 151 + 1 skipped and visual 8/8 unchanged (the spike proved the phase-5 code on a 008 database).

**T2. Booking, email and admin SQL leave the phase-1 columns.**
- `lib/server/booking/rules.ts` (`destination_id`; closure scope; unpublished/archived → `restaurant_unavailable`), `config.ts:389`, `recipients.ts:39`, the admin restaurant-option queries.
- `groupPhoneSql`: restaurant's own phone → its destination's (via `destination_id`) → the first destination with one. `ORDER BY r.sort_order, r.id` in every rule and option query (phase-4 deferral).
- Tests: `booking-rules` (null group phone, own phone first, tiebreak), `submit-reservation` (unpublished / archived refused), recipients reach via `destination_id`.

**T3. The read layer, the catalogue and the one `site_settings` reader (no visible change).**
- `lib/server/content/sql.ts` (read §2), `lib/cache-plan.ts` + test, `lib/content/types.ts`, `lib/content/format.ts` + test (`"9 Sep 2026"`, `VND 888,000++ per guest`, `VND 450,000 net per guest`; CI runs it on Node 24).
- `settings.queries.ts` `loadSiteSettings(db?)` replaces both readers of `site_settings.email` (closes T6.8).
- `restaurants.queries.ts` `loadRestaurants(locale)`: `typeLabel`, ordered cuisine slugs from `restaurant_cuisines`, `destination_id`, card image (media JSON), `phone` (restaurant → destination), server-folded `search` (page language + EN), `hasDetailPage`, `bookingEnabled`, meals from active periods; published and not archived only. `getRestaurants` tags through `LOADERS.restaurants`. Delete `db/queries.ts`.
- `site.queries.ts` / `site.ts`: sections, cuisines, destinations, nav, socials, settings (consumed in T4/T5).
- `test/guards/legacy-columns.guard.test.ts` (R10). `content-loaders.test` for these loaders against the fixture (fallback per field, `machine` behind `serve_machine`, unpublished hidden, nav follows its section). Rewrite `catalogue.test` against the tables.

**T4. The chrome and the `site_settings` handoff.**
- Guarded layout loads `getSiteContent(locale)` and `getSiteSettings()`; `SiteProvider` gets `site`, `destName`, `defaultRestaurantId` (from `site_settings`; NULL = first bookable).
- Header + MenuOverlay from `nav_items` (CSS uppercase, R18), Footer (destinations with `show_in_footer`: `name · address · phone`, `social_links`, `site_settings.email`), Chrome (`booking_bar` section), FilmModal (`film` section: poster `decorative`, link; off hides WATCH THE FILM), privacy `{email}`; `FALLBACK_PHONE` in `error.tsx`, `global-error.tsx`, `DEFAULT_PHONE`.
- `saveInbox` → `updateTag(TAGS.contentContact)`; the T6.2 sentence (R22).
- `check-prerender` layout TAGS = the 10 of §4.6. `playwright.config.ts` desktop-serial `workers: 1`. New `e2e/shared-inbox.serial.spec.ts`.
- Normalised server-DOM diff vs HEAD shows only R18's two differences.

**T5. Catalogue consumers: cuisines rail, filters, search, booking bar, drawer, restaurant cards.**
- Cuisines (chips via `CmsImage`), Finder/FinderSheet (cuisine slugs, meal keys, destination ids; `kind = 'venue'` options), Restaurants chips, SearchOverlay (`r.search`; DB chips; meta `${type} · ${destName}`; thumbnail from `r.image`), BookingBar, ReserveDrawer, RestaurantCard (`CmsImage`, alt from media).
- `filters.spec` +2 (diacritics, type line, cuisine, destination name; Finder Thai + Lunch + MM).

**T6. Home sections from the DB (offers still from `lib/data.ts`).**
- `home.queries.ts` / `home.ts`: hero slides (mobile crop, alt; autoplay from `site_settings.hero_autoplay_ms`), experiences, stories (kicker formatted on the server). The page omits hidden sections and empty lists.
- Hero, Destinations (cards from `destination_i18n` + media), Experiences (side picture from `sections`), Heritage (`sections` image and link), Stories. Plain `<img>` stays plain (R3).
- `check-prerender` PAGE_TAGS `/en` += `content:hero`, `content:experiences`, `content:stories`. `content-loaders` tests for these loaders.

**T7. The generic detail page and the acceptance spec.**
- `loadDetailSlugs`, `loadRestaurantDetail` (read §2 SQL); `getDetailSlugs`, `getRestaurantDetail` (adds `restaurant:<id>` after the query).
- Page: `generateStaticParams` with `_none`; `generateMetadata` (SEO, `${name} — Furama Cuisine`, NOT_FOUND + noindex for an unknown slug or disabled language); `instant = false`; params awaited at the top (phase-2 no-JS rule; spec §6.4's "inside Suspense" stays overridden).
- `git mv` `TayaHero.tsx` → `RestaurantHero.tsx`, `TayaExperiences.tsx` → `Highlights.tsx` (CSS classes keep `taya-*`); `MoreRestaurants({slug, destinationName})` with the `find()`; `MobileBar({detail})` (columns = visible buttons; null at 0); `openMenu` fix (`window.open(url, '_blank')`, then `w.opener = null`; scroll only when `w` is null).
- `restaurant-page.spec` (MENU opens the stubbed PDF tab and the page does not scroll) and `restaurant-pages.serial.spec` (A2). `check-prerender` PAGE_TAGS Tàya += `restaurant:taya-house`.

**T8. Offers from the DB and the daily cron.**
- `loadOffers` (window on `VENUE_TODAY`, published offer and restaurant, venue `coalesce(venue_override, name)`), `getOffers` `cacheLife('hours')`; the page passes offers; `Offers` takes props, keeps "CTA only while bookable" (F10) and builds the note `Offer: ${title}`; the section hides when no offer shows.
- `app/api/cron/daily/route.ts` (GET + `maxDuration = 60`, `cronAuthorized`, `revalidateTag(TAGS.contentOffers, 'max')`, `no-store`); `vercel.json` second cron `5 17 * * *`.
- `check-prerender`: LIFETIME `/en` = 3600/86400; PAGE_TAGS `/en` += `content:offers`; UNCACHED += `/api/cron/daily`.
- `test/integration/cron-daily.test.ts`; `e2e/offers-expiry.serial.spec.ts` (offer 3 past `valid_until` stays until the cron; 401 cron changes nothing; 200 cron → gone within two loads (`'max'`); restore + cron in `finally`).

**T9. `offerId` on the booking (R9).**
- `SiteProvider`, `Offers`, `lib/server/booking/input.ts`, `create.ts` (the subselect), `lib/booking/client.ts` types.
- Tests: `input.test` (valid, malformed dropped), `submit-reservation` (stored; other restaurant, unknown, unpublished, before `valid_from`, after `valid_until` → NULL, booking made), `e2e/offer-booking.spec.ts` (VIEW OFFER on offer 1 → body `{restaurant:'cafe-indochine', offerId:1}`; switching restaurant drops it; POST aborted).

**T10. Delete the constants that are safe to delete (R1).**
- `lib/data.ts` keeps only §4.7's list. The 3 admin pages read destination options and names from an uncached admin reader (default-language name; `kind = 'venue'` for selects).
- Delete content-seed's block 1, shrink `lib/data.test.ts`, replace the README's `db/queries.ts#listRestaurants` references. A test pins `lib/data.ts`'s export list.

**T11. Deferred items: "Gọi để đặt bàn" (R20).**
- Always: the all-offline drawer (`booking.all_offline`, screen `booking`, vars `phone`).
- Owner-gated (ask before the task; drop this half on a "no"): the Call tag on cards and search results (registry keys with `screen`/`vars`/`context`), `booking-switch.serial` updated (Hải Vân shows "Call +84 236 651 9999 →"; Yum Food Village keeps the GX-6 inert assertions; a new all-offline test).

**T12. Acceptance runs and mutations (commit only test changes the mutations prove necessary).**
- Full E2E 3× with `--retries=0` and once with `TZ=UTC`; visual 8/8; the normalised DOM diff vs `8fe98f5` (R18 only); the negative control (edit `experience_i18n` 1 in the E2E DB → visual red on home; restore).
- Mutations, each restored after: (M1) `getRestaurantDetail` without `TAGS.restaurants` → `restaurant-pages.serial` red; (M2) detail loaders ignore `has_detail_page` → red; (M3) `saveInbox` without `updateTag` → `shared-inbox.serial` red; (M4) `loadOffers` without the window → `offers-expiry.serial` red; (M5) cron skips `cronAuthorized` → `cron-daily.test` red; (M6) the insert ignores `offerId` → `submit-reservation` red, the client never sends it → `offer-booking` red; (M7) a loader drops `is_published` → `content-loaders` red; (M8) drop `.hdr-nav .hdr-link` uppercase → visual red; (M9) add `r.destination` to a query → guard red; (M10) re-run the schema spike's 10 seed and 9 migration mutations on the final 008.

**T13. README, the migration 008 runbook and the ledger notes.**
- README: "Migration 008 (phase 6: content)" (§8 below), the daily cron in Deploying and Routes, the Database section's new tables, `db/checks/*`, the first-preview checks, the owner steps.

## 4. Global constraints for the plan

### 4.1 Safety, environment, commands
- `.env.local` points at the **shared/production Neon DB**. Never run `npm run db:migrate`, `npm run db:psql`, `npm run dev`, `vercel env pull`, or any command that reaches Neon, Vercel, an SMTP server or another external service. The plan never applies 008 to Neon (the controller does, §8).
- Every build, `next start`, E2E and visual command uses the phase-5 **EXTENDED** prefix (phase-5 plan lines 37 and 43, unchanged):
  ```bash
  CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= VERCEL_ENV= NEXT_PUBLIC_VERCEL_ENV= VERCEL_OIDC_TOKEN= EMAIL_FROM= EMAIL_REDIRECT_TO= SMTP_HOST= SMTP_USER= SMTP_PASSWORD= BOTID_DEV_BYPASS= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test
  ```
  and, for `next start` and E2E:
  ```bash
  BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson CRON_SECRET=$(openssl rand -hex 16) E2E_PORT=3210
  ```
  `CRON_SECRET` must reach Playwright's own environment too (the cron specs read it).
- Local DBs only: `furama_cuisine_test` (integration), `furama_cuisine_e2e_test` (build, E2E, visual); tests create `furama_cuisine_migrate008_test` and `furama_cuisine_seed008_test` (plus 004–007's); `TEST_DB_TAG=<x>` renames them `…_<x>_test`. Reset with `RESET_DATABASE_URL=postgres://localhost:5432/<name> node scripts/reset-db.mjs`.
- Ports: E2E `3210`, visual `3211` (3200–3299 for agents; CI 3100). `lsof -nP -iTCP:<port> -sTCP:LISTEN` empty before; `lsof -ti tcp:<port> | xargs kill` after.
- zsh: no argument starting with `=`; quote globs and paths with brackets/parentheses; no word splitting of variables (run psql directly, SQL in a heredoc).
- `next build` reads the 008 tables: always reset the E2E DB (which runs all migrations) before building.

### 4.2 Git
- On `main`, one commit per task, no push, `git add` named files only, `git mv` for the two renames (T7). Untracked and left for the controller: the plan file and this folder. Commit messages end with the session's attribution line.

### 4.3 Next 16 and TypeScript 7 (phase-5 rules, plus)
- Read `node_modules/next/dist/docs/` before using a Next API; cite `file.md:line`.
- A cached loader is `server-only`, starts with `'use cache'`, sets `cacheLife('max')` (offers `'hours'`), and tags with `cacheTag(...LOADERS.<name>.tags, TAGS.i18n(locale))` (detail adds `TAGS.restaurant(id)` after its query). Never import a cached wrapper into Vitest; test the `*.queries.ts` function.
- Only server components under `app/(site)/[lang]` call `lang()`; everything else passes the locale.
- `generateStaticParams` never returns `[]` (`['_none']`); no `dynamicParams` export; the detail page keeps `instant = false` and awaits params at the top.
- Dates and prices are formatted inside the cached loaders (server), never in client components.
- No new `next/image` and no new `<img>` sites; lint stays at 19 warnings (the `no-img-element` warning moves from `TayaHero` to `RestaurantHero`).
- `next build` typechecks test files; SQL inside template literals has no backslashes (`[:space:]`).
- Admin rules unchanged (`instant = false`, `requirePermission` first, no guest components).

### 4.4 Versions
No package added or removed. `next@16.3.7`, `react@19.3.0`, `typescript@7.0.2`, `pg@8.23.0`, `zod@4.6.5`, `vitest@5.0.3`, `@playwright/test@1.63.0`, `oxlint@1.86.0`. Node 22.22 locally, 24 on CI and Vercel; Postgres 18.3 locally. `scripts/measure-assets.mjs` imports a `.ts` file through Node's type stripping (Node ≥ 22.18; a harmless `MODULE_TYPELESS_PACKAGE_JSON` notice on stderr).

### 4.5 Names in `db/migrations/008_content.sql`
- New tables: `media`, `media_i18n`, `destination_i18n`, `cuisines`, `cuisine_i18n`, `restaurant_i18n`, `restaurant_cuisines`, `restaurant_highlights`, `restaurant_highlight_i18n`, `sections`, `hero_slides`, `experiences`, `experience_i18n`, `stories`, `story_i18n`, `offers`, `offer_i18n`, `nav_items`, `nav_item_i18n`, `social_links`.
- Extended: `restaurants` (+ `slug`, `destination_id`, `card_image_id`, `detail_image_id`, `og_image_id`, `phone_e164`, `phone_display`, `map_url`, `has_detail_page`, `is_published`, `archived_at`; `type`/`destination` nullable), `destinations` (FK `destinations_card_image_id_fkey`), `site_settings` (+ `default_restaurant_id`, `default_occasion`, `og_image_id`, `hero_autoplay_ms`), `reservations` (FK `reservations_offer_id_fkey`, index `reservations_offer_idx`).
- Constraints: `media_pathname_key`, `media_static_path`, `media_blob_url`, `media_dimensions`; `restaurants_slug_key` (unique index), `restaurants_phone_pair`, `restaurants_detail_image`, `restaurants_published_card`; `restaurant_i18n_one_menu`; `sections_restaurants_visible`, `sections_film_video`; `nav_items_target_section_key`; `offers_price_pair`, `offers_valid_range`. Indexes `restaurant_cuisines_cuisine_idx`, `restaurant_highlights_restaurant_idx`, `offers_restaurant_idx`.
- Fixed seed ids: offers 1–3 (cafe-indochine, taya-house, hai-van-lounge), highlights 1–4, hero_slides 1–3, experiences 1–3, stories 1–4, nav_items 1–6, social_links 1–4; `sort_order` steps of 10; sequences `<table>_id_seq` moved past them.
- Guards that stop 008: a booking with an `offer_id`; a `restaurants.cuisines` label outside the 8 cuisines; `restaurants_published_card` for a restaurant without `public/assets/r-<id>.jpg`.

### 4.6 Tags, loaders and pages
- Loaders (`lib/cache-plan.ts` `LOADERS`, plus `i18n:<locale>` on every per-language loader): `locales`, `strings` (`content:ui`), `legal`, `sections` (`content:sections`, `media`), `settings` (`content:contact`), `cuisines`, `destinations`, `nav` (`content:nav`, `content:sections`), `socials` (`content:contact`), `restaurants` (`restaurants`, `media`), `heroSlides`, `experiences`, `stories`, `offers` (`content:offers`, `restaurants`), `detail` (`restaurants`, `content:destinations`, `media`, + `restaurant:<id>`), `detailSlugs` (`restaurants`).
- `check-prerender` layout TAGS: `restaurants, i18n:en, locales, content:ui, content:sections, content:cuisines, content:destinations, content:nav, content:contact, media`. PAGE_TAGS: `/en` + `content:hero, content:experiences, content:stories, content:offers`; `/en/restaurants/taya-house` + `restaurant:taya-house`; `/en/privacy` + `content:legal`. LIFETIME `/en` 3600/86400; others 2592000/31536000. UNCACHED += `/api/cron/daily`.
- Writes: Server Actions `updateTag` each tag of `tagsForSave(tables, restaurantId)` after COMMIT; everything else `revalidateTag(tag, 'max')`.

### 4.7 Constants
`VENUE_TODAY = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`; cron `5 17 * * *`, `maxDuration = 60`; `NO_PAGE_SLUG = '_none'`; NOT_FOUND metadata "Page not found — Furama Cuisine" + `robots.index false`; detail title fallback `${name} — Furama Cuisine`; `FALLBACK_PHONE = { display: '+84 236 651 9999', tel: '+842366519999' }`; date recipe (en-US `formatToParts`, `${day} ${month} ${year}`, UTC); price recipe (`${currency} ${Intl.NumberFormat(locale).format(n)}` + `++`/` net` + ` per guest`, plain space); offer detail `${price} · ${schedule}`; nav label ≤ 18; `lib/data.ts` keeps exactly `Meal`, `MEALS`, `MEAL_LABELS`, `SLOTS`, `FALLBACK_PHONE`, `Restaurant` and the content DTO types.

### 4.8 Code rules (phase 6)
1. Guest code imports no content from `lib/data.ts` (only §4.7's list).
2. All content SQL lives in `lib/server/content/*.queries.ts`; lists `ORDER BY sort_order, id`; filters `is_published`, `archived_at IS NULL`, media `deleted_at IS NULL`, pages `has_detail_page`.
3. No app SQL reads `restaurants.type/destination/cuisines/meals/slot_capacity` (guard).
4. Language fallback only through `sql.ts` (`LOCALE_CTE`, `i18nJoin`, `tr`, `mediaJson`): default row always; other rows `reviewed`, or `machine` with `serve_machine`; per field.
5. A decorative image renders `alt=""`; `CmsImage decorative` for decorative-by-role.
6. New guest strings go into the registry (`screen`, `vars`, `context`); existing inline section copy stays (R2).
7. Code comments in English, explaining why.

### 4.9 E2E data map (additions; serial specs run in `desktop-serial`, `workers: 1`)

| Spec | Data | Restore |
|---|---|---|
| `restaurant-pages.serial` (T7) | the-fan: `detail_image_id` = `r-the-fan.jpg`, kicker, EN story, 2 highlights, `has_detail_page`; then the Editor saves the-fan's booking-rules form (expires `restaurants`) | `finally`: page off, highlights and page copy removed, the rules form saved again |
| `restaurant-page` (T7) | Tàya page, read-only; the tariff URL stubbed with `context.route` (text/plain) | — |
| `shared-inbox.serial` (T4) | `site_settings.email` = a unique test address, saved through `/admin/settings/notifications` (Admin) | `finally`: `fb@furamavietnam.com` saved through the same form |
| `offers-expiry.serial` (T8) | offer 3 (hai-van-lounge) `valid_until` = yesterday (Da Nang) | `finally`: `valid_until` NULL, then the cron with the secret |
| `offer-booking` (T9) | VIEW OFFER on offer 1 (cafe-indochine); the POST is aborted | — |
| `filters` (T5) | read-only | — |
| `booking-switch.serial` (existing; T11) | taya-house and hai-van-lounge `booking_enabled` off/on | as today |

### 4.10 Gate and baselines
Gate commands: the phase-5 plan's (lines 150–165) with the prefixes of §4.1. Baseline at `4f67931` (= `8fe98f5` for code): unit + integration **68 files, 906 tests**; E2E **151 passed + 1 skipped** (botid); visual **8 passed**; lint exit 0, **19 warnings** (`npm run lint 2>&1 | grep -c ': warning '`). The spikes ended at 71/941 (schema), 73/951 and 155 + 1 (read), 71/946 and 161 + 1 (detail); the merged phase should land near 77 files / ~1000 tests and ~160 E2E. The drafter verifies each task's Expected line in a clone before writing it.

## 5. Review focus: five conditions most likely to bite

1. **A pixel change or a missing string on the guest site.** Check every task's visual run (8/8 at 0, fresh build, never `--update-snapshots`); the normalised DOM diff (only R18's two); a missing translation row must fall back per field, never render empty (a NULL EN field hides only what the old code hid); story dates and prices formatted on the server with the recipes (en-GB "Sept" and Intl's U+00A0 are the traps); nav labels need the CSS uppercase; decorative images keep `alt=""`.
2. **A stale cache after a DB change.** Every loader tags only through `LOADERS`; `cache-plan.test` holds tables ↔ tags; `check-prerender` holds pages ↔ tags; every save in phase 6 (`saveInbox`, booking-rules saves) expires what the pages read; the cached 404 of an unknown slug carries `restaurants`; the offers window has both the `hours` lifetime and the cron. Mutations M1–M4 must stay red.
3. **A DB outage taking the guest site down.** No new request-time DB read on a cached page (check-prerender: fully prerendered, not postponed); `error.tsx`/`global-error.tsx`/`DEFAULT_PHONE` read `FALLBACK_PHONE`, never the DB; the cron uses `'max'` (R7); a loader returns empty lists or nulls for missing optional rows instead of throwing (only a missing `site_settings` row throws). The accepted residue is R8.
4. **The seed drifting from `lib/data.ts`.** `content-seed.test` compares the DB with the frozen fixture, and its block 1 compares the fixture with `lib/data.ts` and the JSX literals until T10 deletes them; `measure-assets.mjs` regenerates the media rows; 008's guards stop on unknown labels and missing pictures; the Neon pre-flight lists the 12 restaurants and 8 labels.
5. **A restaurant page that 404s or leaks unpublished data.** The detail loader requires `has_detail_page AND is_published AND archived_at IS NULL`; the catalogue, offers (and their restaurant), highlights, stories, experiences, nav and socials drop unpublished rows; a non-default-language row shows only when `reviewed` (or `machine` with `serve_machine`); the booking API refuses unpublished/archived restaurants; `_none` keeps the build alive with no page; the acceptance spec proves on → page and off → 404.

## 6. Known risks

1. **Vercel is unverified** for: `updateTag`/`revalidateTag` reaching every instance (F7; phase-4 risk 4); the plain 500 and the never-ending detail stream during a DB outage (R8); the cached 404 headers; the second cron's registration. First-preview checklist in §8.
2. **Node 24 ICU** (CI, Vercel) for the story date: pinned by `format.test` on CI; visual runs only on Node 22 locally.
3. **Payload** grows ~1.3–1.6 KB gzipped per page (site content in SiteProvider); trim later (e.g. drop media sizes from the client).
4. **`/en` now revalidates hourly** (offers `hours`): one background regeneration per hour per instance; with the DB down past `expire` (1 day) the page would fail.
5. **Lock window of 008** on Neon: ACCESS EXCLUSIVE on `restaurants` and `site_settings`, SHARE ROW EXCLUSIVE on `reservations` for ~80 ms locally (one round trip); new bookings wait briefly. Deploy window only.
6. **Preview branches forked before 008** fail to build (safe) until migrated (README rule since 004).
7. **Cross-table invariants not in SQL** (no alt on PDFs or decorative files, menu media is a PDF, `image_mobile_id` only on slide 1, the offer's restaurant = the booking's): enforced by the seed tests now and phase-7 save actions later.
8. **`social_links.visible_locales`** has no FK; a locale rename (phase 8) must rewrite the arrays.
9. **The offers lede** hard-codes "valid until 31 December 2026" and will drift from `valid_until` (R4; phase-7 copy).
10. **Card alt copies the name** (R19).
11. **Random-slug cache growth** until phase 10 (R13).
12. **RSC 404 race** (R15) and the **raw-500 window** (R8) remain upstream behaviours of Next 16.3.7.
13. **Owner answers pending:** Dining House number and display, TikTok handle, offer end dates, "Call to book" (T11 half), Experiences links and the film URL.
14. **Detail pages switched on after a build** render at request time on their first visit, with no App Shell (phase-2 risk 10); the first unknown-slug response is a streamed 200 + noindex.
15. **Search folding** covers Latin diacritics and đ only; phase 8 tests ko/zh.

## 7. Deferred items

**Closed in phase 6:** phase-2 risk 9 (`cuisineSlug`: FK'd cuisines, 008 guard; T1, T3); phase-2 risk 7 metadata (T7, R14); phase-2 Task 4/10 `is_enabled` minor (R16); phase-4 tiebreak and null group phone (T2); phase-4 risk 8 drawer (T11) and card/search (owner-gated); phase-4 RSC 404 residual investigated (R15); phase-5 T6.2, T6.8, the `content:contact` handoff, the privacy `{email}` (T3, T4, R22); Dining House dial target (R18).

**Carried to phase 7 (editors, media, form kit):**
- Registry keys for all section copy and UI text (schema report §2 map), `ADMIN_SCREENS` += cuisines, destinations, experiences, heritage, stories, offers, restaurants; `MEAL_LABELS` → `meal.*`; the CI guard "no guest text outside registry/DB".
- Editors call `updateTag` for `tagsForSave(tables, restaurantId)`; restore inserts with `OVERRIDING SYSTEM VALUE`; the offer delete/restore flow under R5 (links not re-linked).
- Enforce what SQL cannot: EN row required (type_label, labels, names) on save; `has_detail_page` needs `detail_image_id` + EN story, warn under 2 highlights or a hidden button; no alt on PDFs/decorative files; menu media is a PDF; `image_mobile_id` only on slide 1; §6.5 layout limits; nav label > 14 warns.
- Card alt follows a rename (R19); `blur_data_url` on upload; `CmsImage` for the plain `<img>` sites with the Blob move and re-taken baselines (R3).
- Show the offer on the admin booking screens and in the `staff.new` email (`email.staff.new.label_offer`); decide whether the "Offer: …" note prefill stays (R9).
- Offer end dates and the offers lede (R4); Experiences links and the film URL (spec §15 item 16).

**Carried to phase 8 (i18n):** M7 soft-404 title and M4 no-JS shell (R14); phase-2 risks 5–7 (404s of disabled languages); `social_links.visible_locales` on locale rename; search folding for ko/zh; date/price recipes per locale (en-GB vs en-US, digit grouping); nav label overflow in longer languages; Draft Mode rendering a disabled language (R16).

**Carried to phase 10 (hardening):** drop `restaurants.type/destination/cuisines/meals/slot_capacity` and `SLOTS` (with `booking-seed.test`); the DB-down hardening of R8 (`after()` warm-up, `maxDuration` on the detail page, a cache handler if instances do not coordinate); a WAF rate limit on `/:lang/restaurants/:slug` (R13); re-test the RSC 404 race on Next ≥16.4 (R15).

## 8. User runbook (README, T13)

**Migration 008 (phase 6: content)** — the controller runs it; the plan never touches Neon.
1. **What it is:** expand only, one transaction, ~80 ms locally, one round trip. The phase-5 code was verified on a 008 database (build, E2E 151 + 1, visual 8/8), so **008 goes first**, then the phase-6 deploy. The phase-6 build reads the 008 tables: a build on a branch without 008 fails (safely; the old deployment stays live).
2. **Pre-flight**, on the target branch's direct URL, read-only: `psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f db/checks/preflight-008.sql` → every row `ok = true` (001–007 applied and 008 not; none of the 20 tables exists; no `offer_id`; only the 8 cuisine labels; the 12 restaurants of 002, each with `r-<id>.jpg`; every restaurant has a type and a known destination; the 4 destinations without a picture; one `site_settings` row; `en` default; `gen_random_uuid()`). Any `false`: stop; 008 would roll back.
3. **Apply**, in the deploy window (new bookings wait for the lock briefly): dev branch first, then production: `DATABASE_URL_UNPOOLED=<direct URL> node scripts/migrate.mjs`.
4. **Post-check:** `psql … -f db/checks/postcheck-008.sql` → every row `ok` (counts; slug/destination/type/cuisine/card equivalences; only Tàya has a page with its portrait, story and 4 highlights; destination pictures; the offer FK and no linked booking yet; settings Tàya House / Dinner / 7000 ms; every seeded translation `en`/`reviewed`/`seed`; sequences past the seeded ids).
5. **Deploy phase 6.** Preview branches forked before 008 reached production: run `migrate.mjs` on them before their preview builds.
6. **Vercel:** confirm the second cron (`/api/cron/daily`, `5 17 * * *`) is listed; `CRON_SECRET` is already set.
7. **First preview checks:** an admin save (booking rules, shared inbox) shows on the guest site at once from several requests (instance reach); the guest pages' behaviour when the DB is unreachable after a save (R8); the 404 of a random restaurant URL; page weight (+~1.5 KB gzipped).
8. **Rollback:** 008 stays (the phase-5 code runs on it); roll back the deployment only.

**Owner steps:** confirm the Dining House number and whether it prints with +84 (spec §15 item 14); confirm the TikTok handle `@furama.dining.hous`; say whether the three offers end on 31 Dec 2026 (set in the phase-7 editor); answer "Call to book" before T11; provide each further restaurant's page content (4:5 portrait, kicker, EN story, 2–5 highlights, optional menu PDF; spec §15 item 17); Experiences links and a film URL (§15 item 16).
