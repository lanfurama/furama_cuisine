# SDD ledger — plan: docs/superpowers/plans/2026-10-01-phase-2-guest-restructure.md

Spec: docs/superpowers/specs/2026-10-01-admin-cms-design.md (reachable). Work directly on main (user's instruction). Plan committed as 232c3ee.
Verified reference implementation: scratchpad/plan-verify (commits T1 0defe21 + f1aec1d, T2 da1fde5, T3 4cdea36, T4 97b3ec3, T5 ce886af, T6 7be21c5, T7 097bb4e, T8 895c0c8, T9 9c6cc42, T10 89ce5c5; T11 has no commit). Drafted then fully executed green task-by-task by the plan author; the plan was later amended by a 15-finding review fix (see plan Global Constraints / T3 cache-tags / T8 playwright guard / T6 smoke step / T9 rmdir / test-count expectations).

## Setup rulings
- Ruling: implement each task by cherry-picking its verified plan-verify commit(s), then reconciling with the CURRENT plan text (the post-review fixes), running the task's gate, and committing with the plan's message + trailer — the code was executed green in order by the plan author; re-transcribing 5.5k lines adds cost and transcription risk without adding verification — if wrong: a reconciliation miss is caught by the per-task review against the brief.
- Ruling (plan risks "Cần quyết định"): #1 reveal not replaying on preserved page — accept; #2 Finder state survives navigation — accept; #3 intro replays on reduced-motion toggle — accept; #4 Safari <15.4 brief header/booking-bar flash on phone detail page — accept (tiny share, cosmetic); #5 disabled-locale 404 is an empty __next_error__ shell without JS (status 404 + noindex still correct) — accept for phase 2, revisit in phase 8 before enabling any locale; #6 404 <html lang> follows the URL code — accept, revisit phase 8; #7 /zz/restaurants/taya-house 404 carries Tàya metadata — accept, revisit phase 8; #8 random /en/restaurants/<x> adds ISR entries — accept, revisit phase 6/10 (dynamicParams / rate limits); #9 cuisineSlug throws on unknown DB label — accept (phase 6 moves cuisines to an FK'd table); #13 Vercel CDN behaviour unverified — check on the first preview; #16 only if the Task 1 fallback is used — if wrong: cosmetic/edge behaviours ship in phase 2; none corrupts data.

## Pre-flight scan
| Pair / task | Produces → consumes | Finding |
|---|---|---|
| T1 → T5–T11 | visual rig + e2e/paths.ts; every later gate runs visual at ratio 0 | consistent (plan-verify ran it at every task) |
| T2 → T4, T10 | tables locales/content_strings/destinations (+restaurants_destination_fk) | consistent |
| T3 → T4, T9, T10 | cache-tags, registry, format/resolve, locales (pickLocale/toBcp47/LOCALE_CODE_RE/ENABLED_LOCALES), href, booking-errors(strings) | T3 cache-tags expanded post-verify (full §6.2 list) — superset, consumers unaffected |
| T4 → T10 | *.queries.ts loaders (uncached) → 'use cache' wrappers | consistent |
| T5 → T6, T7, T9 | Restaurant.slug/hasDetailPage, DETAIL_PAGE_IDS, DEFAULT_RESTAURANT_ID, cuisineSlug/Label, MEAL_LABELS, MobileBar in pages | consistent |
| T7 → T8, T9 | ViewMarker/pageRoot/showPage/findSection; page-scope spec | consistent; T8 proves page-scope under Activity |
| T8 → T9, T10 | cacheComponents on; getRestaurants('use cache'); playwright E2E_BASE_URL + refuse-next-dev guard (post-verify fix) | guard added post-verify — reconcile in T8 |
| T9 → T10, T11 | route tree under (site)/[lang]/(guarded); proxy; e2e/paths.ts → /en | consistent |
| Self (all) | tests vs code; counts in Expected lines updated post-review | executed green by author; post-review count edits to reconcile |
| Rubric | none found (no assertion-free tests; no logic duplication flagged) | — |

## Progress
Task 1: minor (deferred): visual config defaults baseURL to :3100 (shared with E2E) with no prod-build check; nojs spec uses waitForTimeout(300); VISUAL_SUFFIX not applied to nojs spec; baselines depend on seeded _test content.
Task 1: complete (commits 232c3ee..ea8d8c1, review clean)
Task 2: implementer (haiku) wrote "Claude Haiku 4.5" trailer; controller amended message only (tree identical) → 3433648.
Task 2: minor (deferred): migration-004 test cases depend on order/shared state; default locale can be DELETEd (cascade wipes en strings) — guard in a later phase; before applying 004 on Neon run `SELECT DISTINCT destination FROM restaurants` (FK add fails—safely rolls back—on unknown values).
Task 2: complete (commits ea8d8c1..3433648, review clean)
Task 3: minor (deferred): localeHref with an unrooted path ('restaurants') yields '/enrestaurants'; ?/# paths unhandled; Accept-Language q>1 unclamped, cookie untrimmed; zh-Hans-CN doesn't truncate to zh-hans (phase 8); unknown placeholder now renders literally.
Task 3: complete (commits 3433648..d1966ba, review clean)
Task 4: minor (deferred): loadStrings doesn't check locales.is_enabled for the requested locale (gated upstream by guard/proxy; remember in Task 10); "in one query" title not asserted; no test for keys=[] or a hidden non-reviewed status.
Task 4: complete (commits d1966ba..320f654, review clean)
Task 5: ⚠️ resolved: visual 0-diff (8 passed at ratio 0) reported by implementer against a fresh local build — accepted as the evidence (Chrome/MobileBar move covered by the phone shots).
Task 5: minor (deferred): e2e/filters.spec.ts covers only cuisine chip + one search; no E2E for Finder→filter, occasion chip, SearchOverlay View/Reserve label, MoreRestaurants/CALL/MAP hiding; double blank line in lib/data.ts.
Task 5: complete (commits 320f654..ea4a890, review clean)
Task 6: ⚠️ resolved: visual 8 passed at ratio 0 per implementer (journey reveal animates opacity only; frozen by visual.css).
Task 6: minor (deferred): slide index resets on Hero remount; autoplay wrap/pause conditions untested; dot-click test runs beside the real 7 s timer; journeyStops(0) → Infinity inset.
Task 6: complete (commits ea4a890..54c48b7, review clean)
Task 7: review (opus) Approved, 0 Critical/Important.
Task 7: minor (deferred, plan-mandated): curtain lifts only when a new pageRoot registers — a client navigation to a page without ViewMarker would leave it down and freeze coverThen (plan line 178 rules out a safety timeout because (guarded)/not-found gets ViewMarker view="other" in T9; error page unmounts the chrome) — final review to re-check after T9.
Task 7: minor (deferred, plan-mandated): page-scope guard regex misses useIntro's `root ? root.current : document` fallback, document.body/documentElement.querySelector and multi-line chains — recommend making useIntro's root required + widening the regex (final review triage).
Task 7: minor (deferred, plan-mandated): 4 new oxlint warnings in e2e/page-scope.spec.ts (no-shadow `id`, no-underscore-dangle `__curtain`); one fixed-interval sampler (waitForTimeout(50)×20); intro re-arm also fires when `motion` changes on a visible page.
Task 7: complete (commits 54c48b7..ff3d90c, review clean)
Task 8: review (opus) Needs fixes — 1 Important (plan-mandated): the Playwright guard blocks `next dev` but `next start` also loads .env.local (NODE_ENV=production loads .env.local), so `CI=1 npm run test:e2e` without a local DATABASE_URL reaches the shared/production DB.
- Ruling: FIX — when E2E_BASE_URL is not set, throw unless DATABASE_URL is set and its hostname is localhost/127.0.0.1/[::1]; treat an empty E2E_BASE_URL as unset (reviewer Minor 3, same lines); reword the comment/message to say both next dev and next start read .env.local — CI already sets a localhost DATABASE_URL so CI is unaffected — if wrong: one more env var a developer must set (README already documents it).
Task 8: minor (deferred): check-prerender ignores `postponed` in .meta (partial prerender would pass); global-error renders in the browser default font (font vars undefined there — add var() fallbacks); README:35-39 still says local E2E runs against next dev (Task 11 docs should update).
Task 8: fix round 1/5 (2 addressed, 0 open — E2E guard now requires a localhost DATABASE_URL; empty E2E_BASE_URL = unset; commits 77d2802..97b5bbd)
Task 8: complete (commits ff3d90c..97b5bbd, review clean)
Task 9: implementer DONE_WITH_CONCERNS (cold-build next/font error; one first-run E2E failure set). Review (opus) Approved, 0 Critical/Important; both concerns investigated:
- Concern 1 = upstream Turbopack bug (next-core next_font/google/mod.rs builds the font-file query with qstring from JSON and splits on the `&` inside Google's `l/font?kit=…&skey=…` URLs) — intermittent, path-independent, predates Task 9, fails loudly at build time; can hit CI/Vercel. Recommended fix: self-host both families with next/font/local (needs a visual re-check) — Ruling: defer to a dedicated follow-up task after phase 2 (before relying on CI/Vercel builds) — if wrong: occasional red CI/preview builds until then; retry is the stopgap.
- Concern 2 did not reproduce in 6 fresh-build first runs; first responses are byte-identical to the prerendered files; no product bug.
Task 9: minor (deferred): all 404 pages link to homeHref(DEFAULT_LOCALE) — phase 8 must use the current lang; uppercase locale prefixes (/EN) redirect to /en/EN → 404 (lowercase in proxy).
Task 9: complete (commits 97b5bbd..16d3f44, review clean)
Task 10: minor (deferred): loadStringRows lacks `AND l.is_enabled` — unreachable from the guest site (guard first) but latent for future Server Action / email callers; routing.spec reads .next/server/app/vi.meta (couples to Next internals).
Task 10: complete (commits 16d3f44..4e94c0d, review clean)
Task 11: minor (deferred): README recipe starts `next start -p 3201 &` without a stop step; Routes table doesn't mention proxy bypasses (/api, /_next, /admin, dotted, 2–3 letter top-level); Scripts table alignment.
Task 11: complete (commits 4e94c0d..cd4bab8, review clean)
Final review (opus): "With fixes" — 1 Important (PageCurtain busy flag never reset after an error page → navigation frozen; plan premise "error page unmounts chrome" was false) + Minors 2–9. Ruling: fix wave now = I1, M2 (postponed + nojs home hidden-segment), M3 (booking path tolerant of unknown cuisine label), M5 (README), M6 (?host= guard), M7 (404 title). Deferred with phase owners: M4 (ruling #5 widened: empty no-JS shell also for unknown restaurants/request-time errors — revisit by phase 6), M8 (ruling #8 widened to all proxy-skipped top-level paths — phase 10), M9 (getStrings not tagged `locales`; "one query" title — phase 8). Separate follow-up after the wave: self-host fonts (next/font/local) to remove the upstream Turbopack next/font flake, with a visual re-check, before the first Vercel preview.
Final fix wave: commits cd4bab8..c0155a4 (6e61cff, c23a895, c0155a4); scoped re-review (opus): I1, M2, M3, M5, M6, M7 all ADDRESSED; I1 RED independently confirmed; no new Critical/Important.
Final: parked — new oxlint warning no-extend-native (Array.prototype.find patch in the curtain-recovery E2E) — Ruling: test-only, can wait — if wrong: one lint warning.
Final: parked — E2E flake source: a stuck /_next/image WebP request (dest-future.jpg w=640) on one server process made home-page specs that wait for load/networkidle time out; restart cleared it — Ruling: watch in CI; if it recurs, stop waiting for networkidle on the home page or use unoptimized images in E2E — if wrong: occasional red E2E runs.
Final: parked — M7 title only in the flight payload (server HTML of the soft 404 keeps the home title; cached 404 has none); noindex everywhere — Ruling: phase 6 with the data-driven detail page.
Follow-up (fonts): d2d87df self-hosts both families with next/font/local (18 WOFF2, 300 KiB, byte-identical to Google's; visual 8/8 at 0; cold builds green incl. Google blocked). Implementer concerns: subset-joined family relies on Turbopack not hashing local family names (silent fallback risk under webpack/Next upgrade); E2E /_next/image hang reproduced again (pre-existing).
Follow-up: b4187be (font-face CI guard) + 8c22fab (E2E image-hang workaround; upstream Next 16.3 optimizer bug fixed in 16.4.0-canary.54) reviewed: Approved, minors only (possible false failure if Next ever splits font CSS across chunks; values triplicated with pointer comments; assetPrefix would break file check; visual specs still use the optimizer). Phase 2 complete.
