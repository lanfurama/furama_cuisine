# Phase 2 plan outline: guest-site restructure (Next 16.3.7)

## 0. What I verified myself, on top of the five reports

I made two scratch clones. The repo at `/Users/bcmac/Desktop/projects/Outside Projects/furama_cuisine` was not touched: `git status` is clean and HEAD is 537b7a9. Ports 3241, 3242 and 3243 are stopped and `lsof` shows them free. The DB `furama_cuisine_lead_test` is dropped.

**V1. Visual rig at zero tolerance.** I took the spike-visual rig (`playwright.visual.config.ts`, `e2e/visual.spec.ts`, `e2e/visual.css`, the baselines in `e2e/__visual__/{desktop,phone}/{home,taya-house}.png`) and set `maxDiffPixelRatio: 0`, with no mask.
- Against the pre-change build (spike-visual `.next`, port 3241): 3 of 3 runs passed, 4/4 shots each.
- So the rig is deterministic at 0, and spike-cc's `.hero-slides` mask is not needed.

**V2. "Guarded" variant**, clone `scratchpad/lead-verify`. This is spike-cc plus spike-proxy's route group:
- `app/(site)/[lang]/layout.tsx` is the root layout. It holds fonts, `<html>`, `MOTION_BOOTSTRAP` and `MotionProvider`. It has no database read and never calls `notFound()`.
- `app/(site)/[lang]/(guarded)/layout.tsx` checks the locale (`notFound()` if disabled), calls `getRestaurants(locale)`, and renders `SiteProvider` and `Chrome`.
- Not-found and error files: `[lang]/not-found.tsx`, `(guarded)/not-found.tsx`, `[lang]/error.tsx`.

Results:
- Build: `○ /en`, `○ /en/restaurants/taya-house`. Tags on `en.meta`: `…,(guarded)/layout,…,restaurants,i18n:en`.
- Visual against the pre-change baselines, with `/en` and `/en/restaurants/taya-house` in place of `/` and `/taya-house`: 4/4 shots in each of 2 runs, at ratio 0 with no mask.
- No-JS screenshots (desktop): 2/2.
- spike-cc's 5 behaviour tests: 5/5.
- `/fr` and `/zz/restaurants/taya-house`: real 404, noindex, site fonts, no chrome. The spike-cc variant gave Next's bare 404 here.
- `/en/restaurants/nope`: renders inside the chrome. First request is 200 + noindex, the next is 404 HIT.
- `/nothing/here`: global-not-found, 404. It renders in Times because the file does not load the fonts.
- Database down (port 5999):
  - `/en` and the detail page are served from cache (HIT). `/api/availability` returns 503.
  - After `revalidateTag('restaurants','max')`: one STALE response, then HIT. The old content is kept.
  - After `{expire:0}`: `/en` returns a plain-text 500 (21 bytes). The detail page and an uncached slug return 200 with an empty `__next_error__` document, which the browser fills with **`[lang]/error.tsx`** (fonts, phone number). spike-cc could only show `global-error` here.
- Logs: `scratchpad/lead-build1.log`, `scratchpad/lead-start3242-dbdown.log`.

**V3. Cache Components on today's routes**, clone `scratchpad/lead-t9`. This is the spike-cc client code (ViewMarker, scoped DOM, MobileBar inside the pages, CSS) on `app/layout.tsx`, `app/page.tsx` and `app/taya-house/page.tsx`, with `cacheComponents` and `partialPrefetching` on, and no `[lang]` or proxy.
- Build: `○ / 30d 1y`, `○ /taya-house 30d 1y`.
- Visual at ratio 0: 4/4. No-JS: 2/2. Behaviour: 5/5, now running under Activity.
- **Conclusion:** Cache Components and the route move can be two separate green tasks.

## 1. Verified decisions

| Phase 2 item (spec §14.1 row 2) | Approach | Source |
|---|---|---|
| `app/(site)/[lang]`, only `en` | DB-free root layout plus a `(guarded)` route group that holds the locale check, the DB reads, `SiteProvider` and `Chrome`. `generateStaticParams` in the root layout. `await lang()` from `next/root-params`. | V2 (lead-verify `app/(site)/[lang]/layout.tsx`, `(guarded)/layout.tsx`); spike-proxy (guard idea); spike-cc (real layout body) |
| `proxy.ts` | Named export `proxy`. Shape-based matcher. `pickLocale(cookie, Accept-Language, ['en'])`. Responds 307 with `Vary: Cookie, Accept-Language` and keeps the query. `/admin` gets `next()` for now. **No DB in phase 2.** | spike-proxy `proxy.ts`, `lib/i18n/locales.ts`, `lib/i18n/proxy-matcher.test.ts` (31 tests) |
| `app/taya-house` → `restaurants/[slug]` (constants) | `generateStaticParams` from `DETAIL_PAGE_IDS`. **`const { slug } = await params` at the top of the page, not inside Suspense, plus `export const instant = false`.** `notFound()` for unknown slugs. `generateMetadata` from a constant keyed by slug. | spike-cc final `[slug]/page.tsx` (V2 re-verified no-JS); variant to avoid: `spike-cc-out/page-suspense-variant.tsx` |
| Redirect `/taya-house` | `next.config` `redirects()` with `permanent: true`, which gives 308. It runs before the proxy (proxy.md:236-244). | spike-cc, spike-proxy (curl 308), V2 |
| `global-not-found` + `error.tsx` | `app/global-not-found.tsx` needs `experimental.globalNotFound` and must load the fonts itself (not-found.md:51). `[lang]/error.tsx` with the `retry` prop (error.md:20-30). `[lang]/not-found.tsx` (no chrome, disabled locale). `(guarded)/not-found.tsx` (inside the chrome, unknown slug). `app/global-error.tsx` as a backstop. | V2; spike-cc (file bodies) |
| `cacheComponents` + `partialPrefetching` | Both flags on. Delete `export const revalidate = 3600` (`app/layout.tsx:36`) and `export const dynamic = 'force-dynamic'` (`app/api/availability/route.ts`). `getRestaurants(locale)` uses `'use cache'`, `cacheLife('max')` and `cacheTag('restaurants', 'i18n:'+locale)`. | spike-cc `lib/server/content/restaurants.ts`; V3 |
| Tables `locales`, `content_strings`, `destinations` | Migration `004_foundations_locales_strings_destinations.sql`: idempotent, every seed `ON CONFLICT DO NOTHING`, plus `restaurants_destination_fk`. | spike-data (`db/migrations/004…sql`, `test/integration/migration-004.test.ts`); 110/110 tests |
| Read layer + registry skeleton | `lib/cache-tags.ts`, `lib/i18n/{registry,format,resolve}.ts`. Uncached `lib/server/content/*.queries.ts` (Vitest-testable) plus thin `'use cache'` wrappers `{locales,strings}.ts` (build-tested only). The 12 `error.*` strings move into the registry. | spike-data §2-§10; wrappers verified in `spike-data-next` (root-layout placement). **Guard-layout placement unverified.** |
| Slug keys for cuisines and meals | Map label→slug in `listRestaurants()`: `cuisineSlug`, which throws on an unknown label, and `cuisineLabel`. Meals keep the enum strings as keys, plus a `MEAL_LABELS` display map. No DB change. | codebase-map §3. **Unverified** (not run); pinned by unit, integration and visual tests |
| Remove `'taya-house'` hardcodes | `Restaurant` gains `slug` and `hasDetailPage`, filled in `db/queries.ts`. Constants `DETAIL_PAGE_IDS` and `DEFAULT_RESTAURANT_ID`, the latter passed as a `SiteProvider` prop. Call sites: `RestaurantCard:15`, `SearchOverlay:95`, `MoreRestaurants:12,19`, `TayaHero:51`, `SiteProvider:176` + `openRestaurant`, `MobileBar`. | codebase-map §1-§2. **Unverified**; visual pins it |
| Hero and journey dots from counts | Slide state and autoplay move into `Hero` (`% HERO_SLIDES.length`, dots only when count > 1). Journey line and dots use inline `left` from `n = DESTINATION_CARDS.length`; delete `home.css:626-627`. n=4 gives exactly 12.5/37.5/62.5/87.5. | codebase-map §5. **Unverified**; visual pins it |
| `ViewMarker` | **Wrapper** `<ViewMarker view restaurant>{page}</ViewMarker>` that renders `<main data-view ref>`, provides `usePageRoot()`, and calls `showPage({view, restaurant, root})` in `useLayoutEffect`. `SiteProvider` drops `usePathname` and gains `page`, `pageRoot`, `showPage` and `locale`. View-specific chrome: CSS `html[data-view='detail']` plus a `:has(main[data-view='detail'])` fallback for first paint and no-JS. | spike-cc (`components/site/ViewMarker.tsx`, `SiteProvider` hunks, `styles/booking.css`, `styles/layout.css`, `spike-cc-out/component-changes.diff`); V2, V3. Do **not** use codebase-map's module-registry or `<style>`-ref variant (only proven on a toy app). |
| DOM queries scoped to the current page | `findSection(id)` = `pageRoot.querySelector('[id="…"]')`. Tab sync and pending scroll keyed on `pageRoot`. `useIntro(active, delay, rootRef)` re-arms `data-intro-done` in its cleanup. `useScrollMotion(overlay, pageRoot)` (fixes a dev hydration mismatch). `PageCurtain` uncovers when `pageRoot` changes. `[data-header]` and overlays stay document-wide. | spike-cc (`lib/motion.tsx`, `PageCurtain.tsx`, `IntroTrigger.tsx`); V3 |
| Acceptance: `/en` identical (screenshot) | spike-visual rig at **ratio 0, no mask**. Snapshot names come from page keys, not URLs; only the PAGES map changes at the flip. Add no-JS shots. | V1, V2, V3; `spike-cc-out/visual/nojs.spec.ts` |
| Acceptance: build green | Build needs a reachable DB (already true today). CI already runs build after `reset-db`. | all |

## 2. Spec deviations that need a ruling

1. **§6.4 "params được await bên trong `<Suspense>`".** Measured: even prerendered slugs then ship the body as `<div hidden id="S:0">` plus `$RC`, so with JS off the detail page is blank (screenshot 1280x860 against 1280x2508).
   - **Proposed:** await at the top of the page and add `export const instant = false` (instant.md:66-68).
   - **Cost:** slugs not listed at build (phase 6) render at request time on their first hit, with no App Shell.
2. **§6.1 "`[lang]/layout.tsx`: font, html lang, SiteProvider, Chrome" and "language turned off → `notFound()`".** Calling `notFound()` in the root layout gives Next's bare, unstyled 404, cached for a year. A DB read in the root layout cannot be caught by `error.tsx` (error.md:96).
   - **Proposed:** split into a root layout with no DB and no throw, and `(guarded)/layout.tsx` with the locale check, DB reads, `SiteProvider` and `Chrome` (V2).
3. **§6.1 proxy DB lookup ("best-effort, TTL 60s, ≤500 ms").** Proposed: phase 2 uses the constant `['en']`. The DB variant (`spike-proxy lib/i18n/enabled-locales.ts`, verified working) is deferred to phase 8.
4. **§6.1 matcher "every path that starts with a locale code".** A matcher must be a build-time constant (proxy.md:136), so the implementation is **shape-based**: `[a-z]{2,3}(-[a-z0-9]{2,8})*`.
   - Consequence: an unprefixed top-level path of 2–3 letters (`/faq`) is never redirected.
   - Locale codes are constrained to the same regex by a DB CHECK.
5. **§6.3.8 self-closing `<ViewMarker …/>`.** Proposed: a wrapper that owns the page's `<main data-view>`, because it needs a DOM root to scope queries.
   - `MobileBar` moves into each page.
   - The phone header and booking-bar hides become CSS (`html[data-view]` plus a `:has()` fallback).
   - `useScrollMotion` is scoped too, which the spec does not mention.
6. **Route segment configs the spec does not mention.**
   - Delete `revalidate` (layout) and `dynamic` (availability route); both are build errors under Cache Components (migrating-to-cache-components.md:76).
   - Add `instant = false` on the detail page.
7. **§12 "DB error → `error.tsx` with the phone number".** It works only for streamed request-time renders, with JS, and only because of ruling 2. Remaining gaps:
   - A fully static route (`/en`) whose cache entry has expired gives Next's **plain-text 500**.
   - Without JS the error document is empty.
   - Phase 2 has no tag-expiring writer, so this is latent until phase 3 or 6. Accept it for now.
8. **§6.1 disabled restaurant → `notFound()`.** The first hit is a soft 404 (200 + noindex) and later hits are 404 HIT for 30 days (loading.md:101-113). Accept.
9. **§6.3.2 slug keys.** Cuisine slugs are mapped in the read layer with no DB migration. Meals keep their enum keys plus `MEAL_LABELS`. §6.3.1's `site_settings.default_restaurant_id` becomes the constant `DEFAULT_RESTAURANT_ID` passed as a prop.
10. **004 extras not in spec:**
    - `restaurants_destination_fk`;
    - `locales_default_enabled` CHECK;
    - single-default partial unique index;
    - `card_image_id` without a foreign key;
    - `email` and dining-house `map_url` seeded NULL;
    - `script` seeded as `'latin'` / `'vietnamese'`, which is a guess.
11. **Registry.** Only `{name}` placeholders and no ICU library; a test forbids ICU syntax. Only the 12 `error.*` keys.
12. **Visual tests.**
    - Snapshot path is `e2e/__visual__/{projectName}/{arg}{ext}`.
    - Separate config, local-only on macOS, skipped in CI.
    - Only EN (§13 asks for the longest language too, which comes in phase 8).
13. **Scope notes (not deviations):** nav labels and `MENU_LABELS` (§6.3.6), Intl/ICU (§6.3.4), `CmsImage` (§6.3.7) and search (§6.3.9) are not in row 2. They are left out of phase 2. The cosmetic `lang: 'EN'|'VI'` picker stays as it is.

## 3. Tasks in execution order (all on `main`, one commit per task, each ends green)

Gate for every task: `npm run typecheck`, `npm run lint`, `TEST_DATABASE_URL=… npm test`, then build plus `npm run test:e2e` against a local `_test` DB (see §4 for the E2E rule). From T5 on, also `npm run test:visual` at ratio 0 against a fresh `next start`.

**T1. Visual baseline on today's code (no app change).**
- **Goal:** freeze `/` and `/taya-house` before anything moves.
- **Files:** create `playwright.visual.config.ts`, `e2e/visual.spec.ts` (PAGES map `home: '/'`, `'taya-house': '/taya-house'`), `e2e/visual.css`, `e2e/visual-nojs.spec.ts`, and `e2e/__visual__/{desktop,phone}/{home,taya-house,nojs-home,nojs-taya-house}.png` (commit them, about 10 MB). Modify `playwright.config.ts` (`testIgnore: /visual.*\.spec\.ts/`) and `package.json` (`"test:visual": "playwright test -c playwright.visual.config.ts"`).
- **Tests:**
  - 3 consecutive runs green at `maxDiffPixelRatio: 0`;
  - a negative control (point `home` at the detail URL → it must fail);
  - the existing E2E suite still 7/7 with the visual specs excluded.
- **Deps:** none. This must be the first commit.
- **Copy from:** spike-visual rig (change 0.002 to 0, V1); `spike-cc-out/visual/nojs.spec.ts` for no-JS (`javaScriptEnabled: false`; keep its `.hero-slides` mask, which is the verified no-JS variant).

**T2. Migration 004 (tables).**
- **Files:** `db/migrations/004_foundations_locales_strings_destinations.sql`, `test/integration/migration-004.test.ts`.
- **Tests:** spike-data's migration test list: seeds, CHECKs, single default, default-must-be-enabled, FK cascade, idempotent re-run, upgrade from 003 with an existing reservation.
- **Detail:** use a unique DB name, e.g. `furama_cuisine_migrate004_test`; the 003 test shares `furama_cuisine_migrate_test`.
- **Deps:** T1. **Copy from:** spike-data.

**T3. Pure i18n core.**
- **Files:**
  - `lib/cache-tags.ts` (`locales`, `content:ui`, `restaurants`, `i18n(code)`);
  - `lib/i18n/registry.ts`, `format.ts`, `resolve.ts`;
  - `lib/i18n/locales.ts` (`DEFAULT_LOCALE`, `LOCALE_COOKIE`, `ENABLED_LOCALES = ['en']` for the proxy only, `LOCALE_CODE_RE`, `pickLocale`, pure `toBcp47(code)` such as `zh-hans` → `zh-Hans`);
  - `lib/i18n/href.ts` (`localeHref`, `homeHref`, `restaurantHref`);
  - `lib/booking-errors.ts` (MESSAGES → registry; third argument `strings` defaults to English).
- **Tests:**
  - `lib/i18n/registry.test.ts`, `lib/booking-errors.test.ts` (spike-data);
  - `lib/i18n/locales.test.ts` (spike-proxy `pickLocale` cases plus `toBcp47`);
  - `lib/i18n/href.test.ts`.
- **Deps:** T1. **Copy from:** spike-data, spike-proxy.

**T4. Uncached content loaders.**
- **Files:** `lib/server/content/locales.queries.ts`, `strings.queries.ts`, `test/integration/content-strings.test.ts` (with the `afterAll` reset of `vi`).
- **Tests:**
  - registry fallback when the table is empty;
  - `en` override;
  - reviewed `vi` and per-key fallback;
  - machine rows only when `serve_machine` is on;
  - `loadEnabledLocales` order.
- **Deps:** T2, T3. **Copy from:** spike-data §6, §8, §11.

**T5. Restaurant shape, slug keys, Tàya hardcodes (today's routes).**
- **Files:**
  - `lib/data.ts`: `slug`, `hasDetailPage`, `DETAIL_PAGE_IDS`, `DEFAULT_RESTAURANT_ID`, `cuisineSlug`/`cuisineLabel`, `MEAL_LABELS`, `contactFor`;
  - `db/queries.ts`;
  - components: `Cuisines`, `Finder`, `Restaurants`, `SearchOverlay`, `BookingBar`, `ReserveDrawer`, `RestaurantCard`, `MoreRestaurants` (same `dest`, other `id`, heading from `DESTS`, hidden when empty), `TayaHero` and the `MobileBar` detail branch (take a `slug`, look it up in `useSite().restaurants`);
  - `SiteProvider`: `openRestaurant` uses `r.hasDetailPage`; `defaultRestaurantId` prop. Keep `router.push('/taya-house')` until T9.
- **Tests:**
  - unit tests for `cuisineSlug` and `cuisineLabel` (unknown label throws);
  - extend `test/integration/catalogue.test.ts`: every DB cuisine label maps; `slug === id`; `hasDetailPage` only for `taya-house`;
  - grep shows no `'taya-house'` literal in `components/`;
  - visual 0-diff at `/`; E2E 7/7.
- **Deps:** T1. **Copy from:** codebase-map §1-§3.

**T6. Hero and journey from counts.**
- **Files:** `components/home/Hero.tsx` (local `slide`, autoplay with `% count`, dots only if count > 1), `SiteProvider` (remove `slide`, `goSlide` and the `% 3` interval), `components/home/Destinations.tsx`, `styles/home.css` (delete `.journey-line` left/right at 626-627), and a pure `journeyStops(n)` helper.
- **Tests:**
  - unit `journeyStops(4)` → `[12.5,37.5,62.5,87.5]` with a 12.5% inset;
  - E2E: `.hero-dots` button count equals `HERO_SLIDES.length`;
  - visual 0-diff.
- **Deps:** T5. **Copy from:** codebase-map §5.

**T7. ViewMarker and page-scoped DOM (today's routes, no Cache Components yet).**
- **Files:**
  - new `components/site/ViewMarker.tsx`;
  - modify `SiteProvider` (drop `usePathname` and `navigate`; add `page`, `pageRoot`, `showPage`, `findSection` and the effects keyed on `pageRoot`), `PageCurtain`, `IntroTrigger`, `lib/motion.tsx` (`useIntro` with a root, `useScrollMotion` with the page), `Chrome` (remove `MobileBar` and `data-view`), `MobileBar` (a `restaurant` prop), `Header` (remove `view` and `data-hide-mobile`), `styles/booking.css`, `styles/layout.css`;
  - `app/page.tsx` and `app/taya-house/page.tsx` wrap their content in `ViewMarker` and render `MobileBar`.
  - Paths stay `'/'` and `'/taya-house'`.
- **Tests:**
  - new `e2e/page-scope.spec.ts`: the 5 cases from `spike-cc-out/visual/behaviour.spec.ts`, reading paths from a new `e2e/paths.ts`;
  - red-first structural tests: one `main[data-view="home"]` on home; `html[data-view="detail"]` after a card click;
  - a no-JS phone (390px) check that `.hdr` and `.booking-slot` are hidden on the detail page;
  - hydration test extended to the detail page;
  - visual and no-JS 0-diff.
- **Deps:** T6. **Copy from:** spike-cc (verified as V3).

**T8. Turn on Cache Components (today's routes).**
- **Files:**
  - `next.config.ts` (`cacheComponents: true`, `partialPrefetching: true`);
  - new `lib/server/content/restaurants.ts` (`getRestaurants(locale)` with `'use cache'`);
  - `app/layout.tsx`: `getRestaurants('en')`, delete `revalidate`;
  - `app/api/availability/route.ts`: delete `dynamic`;
  - new `app/global-error.tsx`.
- **Tests:**
  - build output `○ / 30d 1y` and `○ /taya-house 30d 1y`;
  - `page-scope.spec.ts` green, now under Activity. spike-cc's errors #2 and #3 prove this suite fails without T7;
  - hydration test in dev and prod;
  - visual 0-diff.
- **Deps:** T7. **Copy from:** V3 (`lead-t9`), spike-cc.

**T9. Route move under `[lang]`, proxy, redirect, not-found and error pages.**
- **Files:**
  - `app/layout.tsx` → `app/(site)/[lang]/layout.tsx`: no DB; `await lang()`; `lang = LOCALE_CODE_RE.test(code) ? toBcp47(code) : 'en'`; `generateStaticParams` from `ENABLED_LOCALES`; import `'../../globals.css'`; fonts from a new `lib/fonts.ts` (font.md:944).
  - new `(guarded)/layout.tsx`: constant guard, `getRestaurants`, `SiteProvider locale`, `Chrome`.
  - `app/page.tsx` → `(guarded)/page.tsx`.
  - `app/taya-house/page.tsx` → `(guarded)/restaurants/[slug]/page.tsx`.
  - `[lang]/not-found.tsx`, `(guarded)/not-found.tsx`, `[lang]/error.tsx`, `app/global-not-found.tsx` (with fonts).
  - `next.config.ts`: `experimental.globalNotFound` and `redirects()`.
  - `proxy.ts`.
  - `SiteProvider`, `Header`, `Footer`: `homeHref(locale)` and `restaurantHref(locale, slug)`.
  - `e2e/paths.ts` → `/en` and `/en/restaurants/taya-house`; fix `navigation.spec`, `smoke.spec` and `booking-dates.spec` gotos.
  - Visual PAGES map → `/en` and `/en/restaurants/taya-house`. Snapshot files untouched.
- **Tests:**
  - `lib/i18n/proxy-matcher.test.ts` (spike-proxy, 31 tests, `unstable_doesMiddlewareMatch`);
  - new `e2e/routing.spec.ts` with request-level checks: `/` 307 → `/en` with Vary; Accept-Language `vi` → `/en`; cookie `NEXT_LOCALE=vi` → `/en`; `/x?y=1` keeps the query; `/taya-house` 308 and `/taya-house?utm=1` keeps it; `/vi` and `/fr` 404 with noindex; `/nothing/here` 404; `/en/restaurants/nope` is 200+noindex or 404 and shows the chrome in a browser; `/api/availability` and `/icon.svg` are not redirected;
  - new `e2e/nojs.spec.ts` (CI-safe): 12 `.rcard` on `/en`; `.taya-kicker` visible on the detail page; detail HTML has no `hidden id="S:`;
  - `page-scope`, hydration, visual and no-JS all 0-diff.
- **Deps:** T3, T8. **Copy from:** V2 (`lead-verify` `app/` tree), spike-cc, spike-proxy.

**T10. Locale guard from the DB, and strings wiring.**
- **Files:**
  - new `lib/server/content/locales.ts` and `strings.ts` (`'use cache'`, tags `locales`, `content:ui`, `i18n:`);
  - root `generateStaticParams` = enabled codes from the DB ∪ `'en'`;
  - guard uses `getEnabledLocales()`;
  - guard passes `getStrings(code, CLIENT_KEYS)` → `SiteProvider strings` → the 3 `bookingErrorMessage` calls;
  - new `scripts/check-prerender.mjs`: `/en` and `/en/restaurants/taya-house` are in the prerender manifest with 2592000/31536000, and `en.meta` tags include `restaurants`, `i18n:en`, `locales`, `content:ui`.
- **Tests:**
  - `check-prerender` run in CI after the build;
  - `routing.spec` `/vi` 404 while `vi` is disabled;
  - the existing `booking-dates` "That sitting has already started…" pins the strings path;
  - visual 0-diff.
- **Deps:** T4, T9. **Copy from:** spike-data §7, §8, §10 (moved from the root layout to the guard: **unverified**).

**T11. Acceptance and hardening.**
- **Files:**
  - `.github/workflows/ci.yml` (add the `check-prerender` step);
  - optional `lib/page-scope.guard.test.ts`, which scans the source for `document.getElementById` / `document.querySelector` outside an allowlist (`motion.tsx` `[data-header]`, overlays);
  - optional 4 s safety `uncover` in `coverThen`, and `ViewMarker view="other"` inside the not-found and error pages;
  - docs (README or deploying notes): run migration 004 on the Neon target before deploying; the build needs it.
- **Tests:** full gate; visual and no-JS 3× green; dev-mode run of `page-scope` with no console errors.
- **Deps:** T10.

**Parallelism:** the data track (T2→T3→T4) and the client track (T5→T6→T7→T8) are independent until T9.

## 4. Global constraints for the plan

**Versions and docs**
- Next 16.3.7, React 19.3, TypeScript 7.0.2. Cite `node_modules/next/dist/docs/` with path:line.
- `next/root-params` `lang()` works in Server Components only. Server Actions and route handlers get the locale explicitly.
- `app/actions.ts` stays where it is and keeps calling the uncached `listRestaurants()`.

**Databases and E2E**
- Only local `postgres://localhost:5432/<name>_test` databases, created with `RESET_DATABASE_URL=… node scripts/reset-db.mjs`.
- Never run `npm run db:migrate` (it reads `.env.local`, which may still point at Neon production).
- **Never run `npm run test:e2e` in plain local mode.** Without `CI`, its webServer is `next dev`, which reads `.env.local`. Always run `CI=1 DATABASE_URL=postgres://localhost:5432/<x>_test npm run build`, then `CI=1 DATABASE_URL=… npm run test:e2e`. Process env beats `.env.local`.
- Visual runs: `next start` on a fresh build with an explicit `DATABASE_URL`, and `VISUAL_BASE_URL` set. The default is `http://localhost:3100`; an agent picks a free port in 3200–3299.

**Ports**
- E2E: 3100 (`playwright.config.ts`).

**Locales and proxy**
- Seeded locales: `('en','en','English','EN','latin', is_default=true, is_enabled=true, 10)` and `('vi','vi','Tiếng Việt','VI','vietnamese', false, false, 20)`.
- `DEFAULT_LOCALE='en'`, `LOCALE_COOKIE='NEXT_LOCALE'`, proxy `ENABLED_LOCALES=['en']`.
- Locale code regex (DB CHECK and matcher shape): `^[a-z]{2,3}(-[a-z0-9]{2,8})*$`.
- Matcher, exactly:
  `matcher: ['/admin/:path*', '/((?!api(?:/|$)|_next(?:/|$)|admin(?:/|$)|[a-z]{2,3}(?:-[a-z0-9]{2,8})*(?:/|$)|.*\\..*).*)']`
- Proxy response: 307 with `Vary: Cookie, Accept-Language`.
- `/taya-house` redirect: `{ source: '/taya-house', destination: '/en/restaurants/taya-house', permanent: true }`, which gives 308.

**Cache**
- Tags: `restaurants`, `i18n:<code>`, `locales`, `content:ui`.
- `cacheLife('max')` gives `s-maxage=2592000`, revalidate 2592000, expire 31536000.
- Server Actions later use `updateTag`; other writers use `revalidateTag(tag,'max')`.

**Content strings and seeds**
- Content key regex: `^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$`. `CLIENT_KEYS` = the 12 `error.*` keys.
- Destinations seed:
  - `resort`: `+842366519999` / `+84 236 651 9999`, map `https://maps.google.com/?q=Furama+Resort+Danang`, footer, 10;
  - `dining-house`: `+84859555759` / `0859 555 759`, footer, 20;
  - `mm`: 30;
  - `future`: teaser, 40.

**File paths**
- `app/(site)/[lang]/layout.tsx`, `app/(site)/[lang]/(guarded)/layout.tsx`, `…/(guarded)/page.tsx`, `…/(guarded)/restaurants/[slug]/page.tsx`
- `app/(site)/[lang]/{not-found,error}.tsx`, `…/(guarded)/not-found.tsx`
- `app/global-not-found.tsx`, `app/global-error.tsx`, `proxy.ts`
- `lib/server/content/{restaurants,locales,strings}.ts` and `*.queries.ts`
- `lib/i18n/{locales,href,registry,format,resolve}.ts`, `lib/cache-tags.ts`, `lib/fonts.ts`
- `app/icon.svg` stays at the app root (verified ○).

**Code rules**
- `'use cache'` wrappers must never be imported by Vitest: `cacheTag()` throws outside Next.
- `async` components that only throw need `: Promise<React.ReactNode>`.
- Error boundary prop is `retry`. Never show `error.message` in production; it is minified. Use `digest`.
- Scroll offsets stay 75 (desktop) and 63 (below 1080px).

**Visual rig**
- `maxDiffPixelRatio: 0`; desktop 1280x860; phone = iPhone 13 profile on chromium.
- `reducedMotion: 'reduce'`, `page.clock.setFixedTime(new Date('2026-10-05T03:00:00Z'))`, `/api/availability` mocked, `sessionStorage['fc-intro-seen']='1'`, `stylePath: './e2e/visual.css'`.
- `snapshotPathTemplate: '{testDir}/__visual__/{projectName}/{arg}{ext}'`. Baselines are macOS-only; CI skips them.

## 5. Review focus: five conditions most likely to bite after phase 2

1. **Old and bookmarked links.**
   - `/taya-house`, `/taya-house?utm=…`, `/taya-house/`, `/` and unprefixed deep links.
   - Risks: redirect chains, lost query strings, a 307 vs 308 mix-up, a proxy loop.
   - Pins: `e2e/routing.spec.ts` (status, `location`, query kept) and `proxy-matcher.test.ts` (`/en…` never matched, so no loop).
2. **Accept-Language `vi` or cookie `NEXT_LOCALE=vi` while `vi` is disabled, and direct `/vi`.**
   - Must land on `/en`. `/vi` must be a real 404, branded, with noindex. It must not be Next's bare 404 cached for a year.
   - Pins: `locales.test.ts` (`pickLocale`), `routing.spec.ts`, and in T10 the `locales` tag on the cached 404.
3. **Pages hidden by `<Activity>`.** Previous routes keep their DOM, duplicate ids and `data-intro-done`, and their effects tear down.
   - Header DESTINATIONS on the detail page must go home and scroll.
   - Back must go to `#restaurants`.
   - The entrance must replay on a second visit.
   - The curtain must cover then uncover.
   - No dev hydration mismatch from parallax.
   - Pins: `e2e/page-scope.spec.ts` (5 cases), the hydration test on both pages, optional source-guard test.
4. **Database down with Cache Components.**
   - Cached and prerendered pages must stay up. `/api/availability` returns 503.
   - Request-time renders show `[lang]/error.tsx` with the phone number, not `__next_error__` and not the plain 500.
   - Pins: a manual or scripted day-1 check (V2 recipe: `next start` against a dead port, a temporary route calling `revalidateTag`, then delete it). There is no CI test, since phase 2 has no tag-expiring writer.
5. **Bots, crawlers and no-JS visitors.**
   - Random `/en/restaurants/<x>` gives a soft 404 (200 + noindex) and then a 404 cached for 30 days; each random URL also adds an ISR entry.
   - No-JS visitors must see the full detail body; this is why ruling 1 matters.
   - Pins: `e2e/nojs.spec.ts` (CI) and the `visual-nojs` 0-diff (local).

## 6. Risks and day-1 checks

**Risks**
- **Vercel is unverified.** Everything was checked on self-hosted `next start`. On Vercel, `'use cache'` runtime entries are in memory per instance (use-cache.md:251), and CDN handling of tagged pages, cached 404s and the plain 500 is unknown. Do a preview check once Vercel is connected to GitHub.
- **Build needs migration 004 (T10).** Production and preview builds will fail until 004 is applied on the target Neon branch. The failure is safe, since the old deployment stays live, but the runbook must say "migrate before deploy".
- **App Shells are empty.** `[lang].html` and `[slug]` fallback shells are 0 bytes, because `await lang()` and `await params` run outside Suspense. Locales and slugs enabled after the build render at request time on their first hit. This matters in phases 6 and 8 and is accepted now.
- **`:has()` fallback.** On Safari below 15.4, a phone visitor briefly sees the header and booking bar on the detail page until hydration.
- **Curtain can stay down.** If a client navigation lands on a not-found or error page with no `ViewMarker`, the curtain never lifts. Today no UI path reaches that, but an RSC failure could. Mitigate with T11's safety timeout and `ViewMarker` inside those pages.
- **Small behaviour changes (decide or accept):**
  - `useReveal` reveals do not replay on a preserved page;
  - Finder filter state survives going back and forth;
  - `useIntro` replays when the reduced-motion setting is toggled.
- **`cuisineSlug` throws on an unknown label.** A hand-edited DB row fails the build, or keeps the stale page after a `'max'` revalidate. The integration test guards the seed.
- **Global-not-found fonts.** `global-not-found` renders in Times unless it loads the fonts (V2). It needs `lib/fonts.ts`.
- **Matcher shape.** Any future unprefixed 2–3 letter top-level route will 404.
- **Minor nits:**
  - The `/zz/restaurants/taya-house` 404 shows Tàya metadata, because `generateMetadata` runs before the guard.
  - `/fr` has an empty no-JS document.
- **Flaky waits.** The behaviour tests use fixed waits (1200 and 1500 ms). Replace them with `expect.poll` before CI, which retries once.
- **Next upgrades.** In 16.3.7, `usePathname` under unknown params produced an empty shell silently instead of failing the build. Any Next bump must re-run visual, no-JS and `page-scope`.

**Day-1 checks**
1. T1 baseline is stable 3× at ratio 0 and the negative control fails.
2. After T8, the build shows `○ / 30d 1y` and `page-scope` passes in dev (no console errors) and in prod.
3. After T9, the curl matrix in `routing.spec` passes and `[lang]/error.tsx` shows during a DB outage (V2 recipe).
4. After T10, `check-prerender` finds all four tags on `en.meta`.
5. On the first Vercel preview, check `x-vercel-cache`, `/` → `/en`, `/taya-house` 308, `/vi` 404, and that migration 004 is present on the preview's Neon branch.

**Evidence paths:**
- `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/lead-verify` (V1, V2; `lv/` specs, `lv.config.ts`)
- `…/scratchpad/lead-t9` (V3)
- `…/scratchpad/spike-cc-out/` (behaviour, no-JS and DB-down specs)
- `…/scratchpad/spike-visual/` (rig and baselines)