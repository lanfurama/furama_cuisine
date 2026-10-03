# Phase 6 ledger — content to the database

Plan: `docs/superpowers/plans/2026-10-03-phase-6-content-to-db.md`. Spec: `docs/superpowers/specs/2026-10-01-admin-cms-design.md` (amended ef038cc: R7 nightly offers cron `'max'`, R8 §12 note).

Executed on `main` from a1cf5ce to 9b20103:
- 13 task commits, each cherry-picked from the verified clone and given a task review.
- 1 review-fix commit: 0180c11, which keeps the whole number to call inside the restaurant card.
- The controller's spec amendment: ef038cc.
- A 4-group final fix wave: 666ac7b, c56d986, c999ad7 and e863c7e.
- The README's launch-A update: 9b20103.

Acceptance:
- The guest site stays pixel-identical: visual 8/8 at ratio 0 at every commit. The server DOM diff against the pre-phase build shows only R18's two intended differences: nav labels are uppercased by CSS, and the Dining House link dials in E.164.
- Enabling `has_detail_page` for another restaurant gives it a working page, and switching it off gives a real 404. Both are proven in a browser by `e2e/restaurant-pages.serial.spec.ts`, with mutation runs.

Final gate:
- typecheck clean; lint exit 0 with 19 warnings.
- Unit and integration: 83 files, 1039 tests.
- build and check-prerender pass.
- DOM diff: R18 only.
- E2E: three runs, one of them with `TZ=UTC`.
- Visual: 8 passed.

Owner answers (2026-10-03):
- The Dining House phone display stays `0859 555 759`; its tel: link uses E.164.
- The TikTok handle `@furama.dining.hous` is confirmed.
- Still open: the offers' end date (set in the phase-7 editor), the link targets for Experiences, and the film URL.

## Rulings (in the order they were made)

- - Ruling: implement by cherry-picking each p6-folded commit + reconcile + RED + full gate (phases 2–5 method) — if wrong: misses caught by the per-task review.
- - Ruling: accept plan rulings R1–R22 (owner: follow recommendations); R20 search label "Call →" without the number (measured: the number wraps the name to 3 lines at 390 px) — signed off by the controller — if wrong: the plan records the steps for option 1.
- - Ruling (plan risks "Cần quyết định"): #1 Vercel-only behaviours (updateTag reach across instances, DB-down 500/streaming on the detail page) — check on the first preview, phase 10 hardening; #9 offers lede vs valid_until — owner in phase 7; #13 owner answers — partly closed above — if wrong: surfaced at the first preview.
- Ruling: defer both Task 6 Importants to the phase-6 FINAL FIX WAVE (mandatory items F-A/F-B with tests: solid header on a hero-less home + E2E with hero hidden restored via the R21 path; nav filtered through the same homeSections answer incl. offers-of-today) — neither state is reachable without a DB edit until phase 7's editors, and T8 (home page.tsx) and T9–T11 (SiteProvider.tsx) cherry-picks edit the files a fix would touch — if wrong: none before phase 7; the final wave lands before phase 7.
- Ruling: accept the deferral — Task 12's verified commit already replaces these checks with browser checks (h1 + title) and switches the page off with the switch only; patching now would conflict with Task 12's cherry-pick — if wrong: none, Task 12 lands in the next batch (check it at Task 12's review).
- Ruling: fix Task 11 Important now with CSS only (a call-state modifier class that wraps inside the frame; existing tags and the 8 baselines unchanged) + E2E bounding-box assertion at several widths that the whole tag (incl. the last digit) sits inside the card — a guest could read and dial a wrong number — T12/T13 never touch home.css/RestaurantCard.tsx — if wrong: none.
- Ruling: accept the triage, incl. its three decisions: (1) F-B makes every guest page revalidate hourly (the layout reads today's offers) — cost: a DB outage longer than a day breaks every guest page, not only home; bookings are down then anyway; (2) the ruled F-A E2E moves to phase 7 (no phase-6 save expires the hero/sections caches) — phase 6 proves F-A with unit tests, a CSS browser test and a one-off hidden-hero build; (3) a restaurant at an unpublished destination is hidden and not bookable online, built in phase 7 with the destination editor — if wrong: (1) is one cacheLife value; (2)(3) land one phase later.
- Ruling: apply migration 008 to Neon only after G1 lands, using the final file hash from the report.
- Ruling (F17 step order): the README runbook keeps the general order dev → preview → production; for this project 007 and 008 are already on production (nothing deployed, no dev branch), so launch A step 1/9/11 were updated to say so (9b20103) — if wrong: docs only.

## Final review triage: deferred and dropped items

## Decisions taken in this triage that later phases inherit

- **D1. What an unpublished destination means.** The ledger asked the final review to decide (Task 3/5). The decision: **a restaurant is shown, has a page, carries offers and books online only while its destination is published.** Hiding a destination hides its restaurants everywhere a guest can reach them.
  - Staff paths (`planDay`, the admin lists) still see those restaurants.
  - Phase 7 implements this with the destination editor (L7-2). The decision is needed then and not before: nothing in phase 6 can unpublish a destination.
- **D2. Every guest page revalidates hourly from the fix wave on** (F5 ruling). The `(guarded)` layout reads today's offers so the nav matches the home page. That makes every page carry `content:hero`, `content:experiences`, `content:stories` and `content:offers`. A save to any of those tables then expires every guest page (phases 7 and 10 inherit this).
- **D3. The F-A end-to-end test (hero hidden, then restored through a save, R21) belongs to phase 7.** No phase-6 path expires `content:hero` or `content:sections`, so the test cannot exist without bending R21. Phase 6 proves F-A with unit tests, a CSS-contract E2E and a one-off hero-less build.

## LATER, by owning phase

### Phase 7: content editors and media library

- **L7-1 (mandatory, from F-A / D3).** With the hero and sections editors, add the E2E the ledger ruled for F-A:
  - Hide the hero by `sections.is_visible`, and separately by unpublishing every slide.
  - At 1280, 900 and 390 px, assert:
    - an opaque header at scrollY 0;
    - exactly one `h1`;
    - the first section at or below the header's bottom.
  - Restore through the hero or sections save (R21), then assert that the transparent header and the Hero `h1` are back.
- **L7-2 (D1).** Destination publish semantics. Sources: review M-2, data-migration F5, SEC-1, and the Task 3 and Task 5 ledger lines.
  - Add `AND d.is_published` to:
    - `loadRestaurants`;
    - `loadRestaurantDetail`;
    - `loadDetailSlugs` (it then reads `destinations`, so add `content:destinations` to `LOADERS.detailSlugs`);
    - `loadOffers` (likewise, `LOADERS.offers` gets `content:destinations`);
    - `bookingEnabled` in `lib/server/booking/rules.ts`.
  - Add loader and booking tests for these.
  - A destination save must expire the booking-rules tags too, through `tagsForSave`.
  - The editor warns how many published restaurants the change hides.
  - This also closes the leak of the hidden destination's name and phone into every payload, and the drawer's '—' destination.
- **L7-3.** Define "has a page" once (data-migration F6).
  - The card and `generateStaticParams` ignore a soft-deleted portrait, while the detail loader returns null for it.
  - Fix: phase 7's media library refuses to soft-delete a file that any row still uses. Also share one SQL predicate for `hasDetailPage`, `loadDetailSlugs` and `loadRestaurantDetail` (`has_detail_page AND is_published AND archived_at IS NULL AND` a live portrait).
  - Add the loader tests the Task 7 ledger listed:
    - `loadDetailSlugs` leaves out an archived restaurant;
    - a soft-deleted portrait or highlight image;
    - the precedence of `menu_pdf` over a menu link.
- **L7-4.** `restaurantsWithoutRecipient` reads the raw `booking_enabled`, so it raises a false "no recipient" alarm for a hidden restaurant (Task 2). Switch it to the computed `bookingEnabled` predicate when restaurants can be unpublished or archived.
- **L7-5.** Once a restaurant can have its own phone (`phone_e164`), test that number through `loadBookingEmailData`, and test the `/api/availability` 404 for a hidden restaurant (Task 2). The final review checked the 404 at runtime, but no test pins it.
- **L7-6.** Every save goes through `tagsForSave`:
  - `saveInbox` still calls `updateTag(TAGS.contentContact)` directly (Task 4, plan-mandated in phase 6).
  - Spec §6.2 names `content:film`, `content:finder`, `content:heritage`, `content:booking` and `content:seo`, which no phase-6 loader carries. Phase 7 follows `SAVE_TAGS`/`tagsForSave`, not the spec's literal list.
- **L7-7.** Fix the stray separators for rows phase 7 can create:
  - a footer venue with a phone but no name prints a leading ' · ' (Task 4);
  - 'More at ' shows for an unnamed destination (Task 7);
  - a story with an empty category prints a kicker with a leading ' · ' (Task 6).

  Do it with validation (a venue must have a name), and by joining only non-empty parts.
- **L7-8.** Blob media: escape `url('${r.image.url}')` in the `SearchOverlay` thumbnail with Blob pathname checks (Task 5), and add Blob hosts to `images.remotePatterns` for `CmsImage` (security review, declined note).
- **L7-9.** Before phase 7's new SQL, harden the legacy-columns guard: case-insensitive keywords, comma joins, `.js`/`.mts` files (Task 3). The final review's own grep found nothing slipping past it today.
- **L7-10.** Move `listDestinationOptions` into the content query layer (Task 10).
- **L7-11.** Offers in the drawer:
  - a stale 'Offer: <A>' note survives a switch to offer B (Task 9; phase 7 shows the offer itself);
  - test the inclusive `valid_from` boundary on the submit path (Task 9).
- **L7-12.** Deleting an offer: `reservations_offer_id_fkey ON DELETE SET NULL` runs as an UPDATE, so `reservations_before_write` bumps `version` and `updated_at` on every linked booking without a `reservation_event` (security review, declined note). Staff editing such a booking at that moment hit a concurrency conflict. The offer-delete flow must expect that and decide whether to log it.
- **L7-13.** Restaurant pages without `seo_description` or an OG image fall back to the home page's (guest-identity review, declined note). The SEO editor owns this.
- **L7-14.** Design limits belong to the editors: at most 5 highlights (Task 7), 1–5 hero slides, at most 6 nav items.
- **L7-15.** Key `SOCIAL_LABELS` by the `social_links.platform` enum and move the labels into the registry with the socials editor (Task 4). Today an unknown platform falls back to its upper-case name.
- **L7-16 (R2).** Move the hero copy into the registry, together with the visually hidden home `<h1>` that F4 adds (the same words).
- **L7-17.** CASCADE/RESTRICT coverage (Task 1). The delete and restore tests of phase 7 exercise each foreign key their flows rely on. The final review found the FK matrix consistent.
- **L7-18 (D2).** Measure the R15 RSC-404 race again at phase 7's real save rates. Saves to hero, experiences, stories and offers now expire every guest page, not only `/en`.

### Phase 8: multiple languages

- **L8-1.** The story link fallback skips the default language's `st_d.href` (Task 6): a translated story with no link of its own shows none. Fix the fallback, and test it with a `vi` row.
- **L8-2.** The cuisine chips fall back two different ways, to the slug in one place and to '' in the other (Task 5). Make them one.
- **L8-3.** `format.ts` and `loadOffers('zz')` depend on the process's ICU default locale for a code that Intl accepts but has no data for (Task 8). Map such codes to `'en'` (via `supportedLocalesOf`), and fix the test that compares `'zz'` with `'en'`.
- **L8-4.** The inbox test writes before its `try`, and its `vi` cleanup is too broad: it would delete seeded `vi` rows once phase 8 seeds them (Task 10).
- **L8-5.** Translator context for `booking.call_tag` (detail rail, focus), and an `overflow-wrap` for long translated words in the call tag (Task 11).
- **L8-6.** Deleting a locale cascades its `*_i18n` rows, and `social_links.visible_locales` has no FK (accepted risk 8; data-migration review, declined note). The language manager must handle both, and it must never delete the default language.
- **L8-7.** Add `/sitemap.xml` and `/robots.txt` (spec §6.1, §14.1 row 8). Both are 404 today.
- **L8-8.** Call `requireEnabledLocale` in the privacy page's `generateMetadata` (accepted risk 20). Check the multilingual 404 by its heading in a browser (accepted risk 19). Revisit the soft-404 first response (R14).

### Phase 9: Vertex AI

- **L9-1.** Every `*_i18n.status` defaults to `'reviewed'`. The AI translator and the alt-text writer must set `status = 'machine'` and `origin = 'ai'` explicitly (security review, declined note).

### Phase 10: hardening

- **L10-1 (D2).** Since the fix wave, every guest page expires one day after its last successful render, so a database outage longer than that breaks every guest page (plan risk 4 widened). Combine this with R8's planned warming in `after()` and the detail page's `maxDuration`.
- **L10-2.** Give the `pg` pool a connection timeout and a statement timeout. Today a slow or unreachable database can hang request-time renders (guest-identity review, declined note; the pool dates from phase 1).
- **L10-3.** Rate-limit junk restaurant slugs with WAF rules (R13). After F6, only well-formed slugs still cost a database read and a cache entry.
- **L10-4.** Check the Vercel-only behaviours on the first preview, then harden them (plan risk 1; README runbook):
  - `updateTag` reaching every instance;
  - the cron registration and how precisely it fires on the account's plan;
  - a DB outage right after a save.
- **L10-5.** Test hardening:
  - replace the CSS-class locators in `filters.spec` (Task 5) and `offers-expiry.serial` (Task 8, plan-mandated);
  - replace the `waitForTimeout(300)` 'no scroll' check (Task 7);
  - make the Da Nang date test catch a `CURRENT_DATE` regression by running it with a session TimeZone whose date differs from Da Nang's (Task 8);
  - make the guest-pages guard check that `requireEnabledLocale` comes first, not only that it is awaited (Task 6).
- **L10-6.** The restaurant card's call action is a `<button>` that runs `location.assign('tel:…')`, not an `<a href="tel:…">` (Task 11). Revisit this in the accessibility pass.
- **L10-7.** On the first Linux CI run, watch two checks: `booking-switch.serial`'s `tel:` request assertion and the 8-width bounding box of the call tag. Both pass on macOS. The reviewer had no Linux Chromium.

## DROP, with reasons

- **X1.** Observations of accepted rulings, left as ruled:
  - R7: stale offers once after the cron, with the page surviving a DB outage;
  - R8: a detail page streams `error.tsx` with no end when the DB is down after a save;
  - R13: one DB read and one cache entry per random slug;
  - R14: the first response for an unknown slug is 200 with noindex and the home page's title;
  - R5, R6, R11, R12, R19 (FK actions, the seed strategy, the extra CHECKs, alt = name).
- **X2.** On macOS's case-insensitive disk, a 404 for `/en/restaurants/TAYA-HOUSE` overwrites `taya-house.html`, and a 300-character slug fails with ENAMETOOLONG. This is local-only and has existed since phase 2; Vercel does not cache pages on such a disk. The fix brief forbids such slugs in E2E.
- **X3.** Page payload grew 1.3–1.9 KB gzip per page (accepted risk 3). F5 adds nothing to the client payload.
- **X4.** Restaurant card tags show only on hover, so touch screens never show them. This is the phase-5 design, and a tap still calls.
- **X5.** 008's lock footprint on Neon, and a theoretical deadlock with a concurrent booking: accepted risk 5. Nothing is deployed, and the runbook applies 008 in the deploy window.
- **X6.** "Neon's contents were not checked": the controller runs `preflight-008.sql` on Neon before applying, which is exactly that check.
- **X7.** `/en/restaurants/%FF` and `%C0%AF` return 500. That is Next's own URL decoding, it predates phase 6, and no app code runs.
- **X8.** The cron's 'unset secret' test stubs only `''`. `cronAuthorized` rejects `undefined` and `''` through the same `!secret` branch, so a second stub adds nothing.
- **X9.** A millisecond window at 17:00:00 UTC in the 'offers by date' test (an UPDATE and a read straddling Da Nang midnight). Negligible.
- **X10.** `check-prerender` hardcodes `taya-house`, so it fails on a `_none` build. CI always seeds Tàya, and two final reviewers built and served a `_none` build by hand. This also closes the Task 7 "'_none' not exercised" note.
- **X11.** ICU on Node 24 for story dates and prices: `lib/content/format.test.ts` pins them on CI (accepted risk 2).
- **X12.** Task 1: duplicate test helpers; mixed constraint-lookup style. Style only, with no reader misled.
- **X13.** Task 2: a sort-order comment against the order RED used; a stale test title. Test-internal wording only.
- **X14.** Task 3: the report lacked per-file RED and the changed files (the task is closed); `DestKey = string` (a harmless alias, as Task 10 noted).
- **X15.** Task 6: the guarded layout duplicates the enabled-locale check. That is deliberate: `lang()` can be `undefined` in the layout since app/admin added a second root layout, and the behaviour equals `requireEnabledLocale`.
- **X16.** Task 7: a double blank line.
- **X17.** Task 9: an unused phone column in a test's SELECT.
- **X18.** Task 10: the migration-004 test title names `lib/data.ts`. Historical wording in a phase-2 test.
- **X19.** Task 11:
  - `calls` restates the tag-branch condition (style);
  - the one-line call tag is about 3 px taller (accepted in fix round 1, no baseline shows it);
  - the report lacked commands.
- **X20.** Task 12: a note at :88 that only the second 404 check tells M2 apart; condensed mutation evidence. Both are recorded in the ledger, and the spec is right.
- **X21.** Task 13: the report lacked the Step 6 hand-off and raw command lines. The controller did the spec amendment (`ef038cc`).

## Folded into the fix wave (for traceability)

| Source | Fix item |
|---|---|
| Task 6 Important 1 (F-A); Task 6 minor: no test for a soft-deleted hero image or for the wiring of `homeSections` | F4 |
| Task 6 Important 2 (F-B); Task 8 minor: the Offers nav item stays; Task 6 minor: destinations and cuisines are not passed to `homeSections` (`journeyStops(0)`) | F5 |
| data-migration F3: the nav CHECK admits hero and booking_bar | F1 |
| Task 1 minor: TikTok comment; Task 13 minor: "awaits the owner" in 008 and content-loaders.test; Task 1 minor: the comment overclaims what a re-run does | F2 |
| Task 1 minor: postcheck checks 4 of 7 sequences | F3 |
| review M-1 and security SEC-3: slug with `%00` or over-long | F6 |
| security SEC-2: hidden sections in the payload | F7 |
| Task 11 minors: empty drawer band; the Firefox arrow; the search "Call →" tap untested; the guest context closed only on success | F8, F9, F10 |
| Task 7 minor: `openTheFan` before `try`; Task 4 minor: privacy not revisited; tests-ops F3: on-disk ISR copies after E2E | F11, F19 |
| Task 5 minor: the 'hotpot' step does not isolate `cuisine_i18n` | F12 |
| Task 3 minors: the format.test TZ restore; format.ts lacks server-only; the settings "only reader" comment; Task 1 minor: the `jpegIsRotated` doc | F13, F14, F16 |
| tests-ops F5: vercel.json crons unpinned | F15 |
| tests-ops F4: launch A and 008; data-migration F4: edits to 008 after the apply drift silently | F17, plus the G1 ordering ruling |
| data-migration F7: a redeploy after a content migration | F18 |
| Task 13 minors: README cacheLife line, line over 100 columns, the "bare SQL" claim; the email log not emptied in the README's local E2E command | F19 (and the README part of F5) |

## Applied to Neon (2026-10-03)

Pre-flight (`db/checks/preflight-008.sql`, run inside a read-only transaction): 10/10 rows true.
- `_migrations` held 001–007.
- None of 008's tables existed.
- No booking carries an `offer_id`.
- Every cuisine label is one of the 8.
- All 12 restaurants exist, each with its card picture.
- Every restaurant has a type and a known destination.
- The 4 destinations exist.
- The `site_settings` row exists.
- The `en` locale exists.
- `gen_random_uuid()` is available.

Migration 008 was applied with `scripts/migrate.mjs`: blob 05a856db, sha256 8f0869…d755.

Post-check (`db/checks/postcheck-008.sql`, read-only): 10/10 rows true.
