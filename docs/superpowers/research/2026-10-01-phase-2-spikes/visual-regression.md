# Phase 2 spike: visual-regression baseline (Playwright toHaveScreenshot) captured before the restructure, URL-swap comparison, CI strategy

## Verified patterns

All files live in the clone /private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/spike-visual (original repo verified clean, server on :3251 killed, lsof empty). DB: furama_cuisine_spikevis_test, created via `RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_spikevis_test node scripts/reset-db.mjs` (3 migrations applied).

## Setup
```
export DATABASE_URL=postgres://localhost:5432/furama_cuisine_spikevis_test
npm run build && nohup npx next start -p 3251 &      # production build, never `next dev` (dev overlay)
export VISUAL_BASE_URL=http://localhost:3251
npx playwright test -c playwright.visual.config.ts --update-snapshots   # generate baselines ONCE
npx playwright test -c playwright.visual.config.ts                      # compare
```
Why a separate config: the main playwright.config.ts has a single 'desktop' project and starts its own webServer (dev server locally). The visual config has no webServer (uses a running build), two projects, and a custom snapshot path.

## playwright.visual.config.ts
```ts
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  testMatch: /visual\.spec\.ts/,
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
  // no OS suffix in the file name -> files are named by logical page, not by URL or platform
  snapshotPathTemplate: '{testDir}/__visual__/{projectName}/{arg}{ext}',
  expect: { toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.002 } },
  use: { baseURL: process.env.VISUAL_BASE_URL ?? 'http://localhost:3100' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } } },
    { name: 'phone', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
});
```

## e2e/visual.css (injected via stylePath)
```css
/* Injected by toHaveScreenshot: freeze everything that moves on its own. */
*, *::before, *::after {
  transition: none !important;
  animation: none !important;
  scroll-behavior: auto !important;
  caret-color: transparent !important;
}
/* Hero Ken Burns: the 7s transition races the capture; pin the end state. */
.hero-slide-zoom { transform: scale(1) !important; }
/* Scroll-linked parallax is rAF-driven and lags the scroll back to 0; at scrollY=0 its true offset is none. */
[data-parallax] { transform: none !important; translate: none !important; }
```

## e2e/visual.spec.ts (final, working)
```ts
import { expect, test, type Page } from '@playwright/test';

/**
 * Logical page -> URL. Snapshot names come from the KEY, never the URL, so the
 * phase-2 restructure only edits this map ('/' -> '/en', ...).
 * VISUAL_SUFFIX lets a run hit the same page under a different URL (used to
 * prove the comparison works across URLs: VISUAL_SUFFIX='?x=1').
 */
const PAGES = {
  home: '/',
  'taya-house': '/taya-house',
} as const;
const SUFFIX = process.env.VISUAL_SUFFIX ?? '';

const FIXED_NOW = new Date('2026-10-05T03:00:00Z'); // 10:00 in Da Nang

async function prepare(page: Page) {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  await page.emulateMedia({ reducedMotion: 'reduce' }); // data-motion="off": no reveals, no hero timer
  await page.route('**/api/availability**', async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      json: {
        today: '2026-10-05',
        now: FIXED_NOW.toISOString(),
        date: url.searchParams.get('date') ?? '2026-10-05',
        booked: {},
        capacity: {},
      },
    });
  });
}

async function settle(page: Page) {
  // Walk the page so every next/image lazy-loads, then return to the top.
  // behavior:'instant' because the site sets scroll-behavior: smooth.
  await page.evaluate(async () => {
    const height = document.documentElement.scrollHeight;
    const step = Math.max(window.innerHeight / 2, 300);
    for (let y = 0; y < height; y += step) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 80));
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
    // let scroll-driven effects (header state, parallax) run their rAF before the shot
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  // Only images that are on-canvas count: carousel items scrolled out of view
  // horizontally and inactive hero slides stay lazy forever and are not in the shot.
  await page.waitForFunction(() =>
    [...document.images]
      .filter((i) => {
        const r = i.getBoundingClientRect();
        return r.width > 0 && r.right > 0 && r.left < window.innerWidth;
      })
      .every((i) => i.complete && i.naturalWidth > 0),
  );
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
}

for (const [name, path] of Object.entries(PAGES)) {
  test(`@visual ${name}`, async ({ page }) => {
    await prepare(page);
    await page.goto(path + SUFFIX);
    await settle(page);
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true, stylePath: './e2e/visual.css' });
  });
}
```
Nothing needed masking: with the mocked availability response and fixed clock, no time-dependent text is rendered (a `mask` option remains available if phase 2 adds any).

## Stability proof (final spec + css, same baselines, no --update-snapshots)
```
== stability run 1:  4 passed (7.4s)   [desktop home 2.4s, desktop taya-house 1.1s, phone home 2.4s, phone taya-house 0.8s]
== stability run 2:  4 passed (7.2s)
== stability run 3:  4 passed (7.2s)
```
Extra evidence: after the last fix, phone/home alone ran 30 consecutive times with zero failures (loop `for i in $(seq 1 30) ... || break`, printed `done 30`).

## URL-swap proof
Same baselines, same snapshot names, URL changed from `/` and `/taya-house` to `/?x=1` and `/taya-house?x=1`:
```
VISUAL_SUFFIX='?x=1' npx playwright test -c playwright.visual.config.ts
  ✓ [desktop] @visual home   ✓ [desktop] @visual taya-house
  ✓ [phone] @visual home     ✓ [phone] @visual taya-house
  4 passed (7.7s)
```
Negative control (proves the comparison really detects change): pointing `home` at '/taya-house' gives
`✘ [desktop] @visual home: Expected an image 1280px by 5560px, received 1280px by 2508px. 3596580 pixels (ratio 0.51) are different.` (spec restored afterward).

After phase 2 the only edit is the PAGES map: `home: '/en'`, `'taya-house': '/en/restaurants/taya-house'`. Snapshot files (desktop|phone)/(home|taya-house).png are untouched, so a pass == "/en looks identical to today's /".

## Snapshots: location and size
- Path (via snapshotPathTemplate): e2e/__visual__/{desktop,phone}/{home,taya-house}.png
- Sizes: desktop/home 3.96 MB (1280x5560), desktop/taya-house 1.33 MB, phone/home 1.67 MB (390x6765), phone/taya-house 0.51 MB. Total 7.1 MB on disk.
- Recommendation: commit them (they are the phase-2 acceptance baseline; regenerating after the restructure would defeat the purpose). 7 MB is acceptable for a one-off baseline; if it grows, store only during phase 2 and delete or put in git LFS afterward. playwright-report and test-results are already gitignored; do not ignore e2e/__visual__.

## Platform / CI recommendation
Docker is available locally (Docker version 29.3.1, build c2be9cc) but I did not run the Playwright image. These baselines are macOS Chromium renderings; Linux CI will anti-alias text differently even with self-hosted next/font, so they would fail in CI.
- Option A, local-only (RECOMMENDED for phase 2): tests are titled `@visual`; the main CI run (`playwright test`, config playwright.config.ts) already ignores them because the main config has no visual.spec.ts exclusion today, so add `grepInvert: /@visual/` (or `testIgnore: /visual\.spec\.ts/`) to playwright.config.ts so CI and `npm run test:e2e` skip them, and add `"test:visual": "playwright test -c playwright.visual.config.ts"` to package.json. Pros: zero CI maintenance, no flake from font rendering, matches the actual need (a one-time before/after comparison on the developer's Mac). Cons: not enforced automatically; a regression after phase 2 is only caught if someone runs it.
- Option B, Linux baselines generated in Docker (mcr.microsoft.com/playwright:v<exact @playwright/test version>-noble; run `next build/start` + playwright inside, `--update-snapshots` once) and run in CI on the same image. Pros: enforced on every PR, deterministic. Cons: must pin the image tag to the installed Playwright version, containers on Apple Silicon are arm64 vs GitHub runners x64 (font rasterisation can differ slightly, so generate baselines on the CI runner itself or an amd64 image with --platform linux/amd64, which is slow under emulation), DB service needed in the job, and baseline PNGs get re-reviewed on every design change.
- Suggestion: A now; adopt B later only if the team wants permanent visual gating after the CMS phases settle.

## Errors hit
- **First baseline run: phone project failed with `page.waitForFunction: Test timeout of 60000ms exceeded` in settle() waiting for all document.images to be complete**
  - cause: Lazy images that are never on-canvas never load: horizontally scrolled carousel items (cuisine-ring, dest-zoom, story-zoom at x > viewport width) and inactive hero slides (display:none on phone, width 0). Also window.scrollTo with the site's `scroll-behavior: smooth` is async, so the scroll walk did not actually reach all lazy images.
  - fix: Scroll with `behavior: 'instant'` and only wait for images where rect.width > 0 && rect.right > 0 && rect.left < innerWidth.
- **A debug node script using the same scroll loop hung >120 s and was moved to background**
  - cause: Same smooth-scroll issue plus no timeout; macOS has no `timeout` command.
  - fix: Use `perl -e 'alarm N; exec @ARGV' <cmd>` for hard timeouts; instant scroll.
- **Flaky phone/home: 6702 pixels (ratio 0.01) differ in region (0,0)-(390,588) on ~1 of 6-10 runs (hero image offset ~10px vertically)**
  - cause: Hero image is moved by two things Playwright's animations:'disabled' does not cover reliably: the 7s Ken Burns `transition: transform` on .hero-slide-zoom, and the rAF-driven scroll parallax in lib/motion.tsx (sets the CSS `translate` property, not `transform`, on [data-parallax]) that lags the scroll back to 0.
  - fix: stylePath e2e/visual.css: transition/animation none, .hero-slide-zoom transform scale(1), [data-parallax] transform:none and translate:none; plus a double requestAnimationFrame after scrolling to top. After the fix: 30/30 consecutive phone/home passes and 3/3 full runs. Note: the intermediate fix with only `transform: none` was not enough because the site uses `translate`.
- **`sed -i "s#...#...#" file` failed: invalid command code e**
  - cause: BSD sed on macOS requires `-i ''`; the edit silently did not apply (and a subsequent run appeared to pass without stylePath).
  - fix: Use python for edits or `sed -i ''`; always grep to confirm the edit applied.
- **First server start produced HTTP 000 / connection refused**
  - cause: Typo in my redirect target (`/tmp/../dev/null`) made the shell abort the start.
  - fix: Use nohup with an output log in the scratchpad.

## Recommended task breakdown

1. (Before any phase-2 code) Land the visual harness on main: e2e/visual.spec.ts, e2e/visual.css, playwright.visual.config.ts, `test:visual` script, `grepInvert: /@visual/` (or testIgnore) in playwright.config.ts so CI skips it, and the four committed baseline PNGs (7 MB). Generate them from a production build of the pre-restructure code with a seeded local _test DB, not Neon, and never regenerate them during phase 2.
2. Phase-2 tasks proceed; after the route move (task that creates app/(site)/[lang] and moves taya-house) change only the PAGES map to '/en' and '/en/restaurants/taya-house' and run `npm run build && next start -p <port>` then `npm run test:visual`. Expect pass; any diff must be explained by an intended change (e.g. lang attribute or journey-dots computed from counts) and reviewed from the generated *-diff.png, then baselines updated deliberately in a separate commit.
3. Add a separate, non-visual E2E assertion that /taya-house redirects to /en/restaurants/taya-house (the visual test follows redirects, so it would not catch a missing redirect if the map still pointed at the old URL).
4. Optional later: Linux baselines in Docker + CI job (Option B) if permanent visual gating is wanted.

## Risks / open questions
- Masked behaviour: reduced-motion + stylePath freeze reveals, Ken Burns, parallax, hero timer. The baseline therefore verifies layout/static visuals, not animations; motion regressions in phase 2 (ViewMarker, partial prefetching, entrance replay) need the existing E2E or manual checks.
- The test forces [data-parallax] translate:none and .hero-slide-zoom scale(1); if phase 2 renames these classes/attributes the CSS must be updated in lockstep or the visual test will flake again (the symptom is a ~10px vertical hero shift on phone).
- Full-page screenshots of a 5560px/6765px page are big (about 4 MB for desktop home); maxDiffPixelRatio 0.002 allows ~14k differing pixels on desktop home, which could hide small text changes. Consider a tighter ratio (0.0005) or element-level screenshots of the hero/nav/restaurant grid for phase-2 acceptance.
- Image-load detection ignores images not in the horizontal viewport; if phase 2 changes carousels to render differently the wait condition may need revisiting.
- Baselines depend on the 12 seeded restaurants and local asset files in public/assets; changing seed data or images invalidates them.
- A fixed clock via page.clock.setFixedTime only affects the browser; the server-rendered HTML (ISR 1h) is not clock-mocked, harmless today because no server-rendered text depends on the current date, but with cacheComponents/dynamic 'today' this must be re-checked.
- Not tested: the tests were run against a production build on a developer Mac only; Linux/Docker rendering was not executed, only checked that Docker is installed (29.3.1).
- Playwright `animations: 'disabled'` alone is insufficient for this site (see errors_hit); future infinite or JS-driven animations will need the same CSS treatment.

## Spec deviations
- The spec/task suggested snapshots at e2e/visual.spec.ts-snapshots/...; I overrode snapshotPathTemplate to e2e/__visual__/{projectName}/{arg}{ext} so file names carry neither the OS suffix nor the URL (needed for the cross-URL comparison and keeps them independent of the spec file name).
- The visual specs use their own config (playwright.visual.config.ts) rather than a project in playwright.config.ts, because the main config starts a dev server (overlay/indicator pollutes screenshots) and has only the desktop project; the phone viewport is Chromium with iPhone 13 device settings (defaultBrowserType forced to chromium) so no WebKit is needed.
- Playwright animations:'disabled' plus reducedMotion was not sufficient for determinism; an injected stylesheet (stylePath) is also required.

## Doc citations
- Playwright toHaveScreenshot options animations/caret/stylePath/maxDiffPixelRatio/snapshotPathTemplate are from @playwright/test ^1.63 (behaviour verified empirically in this spike; the Playwright docs were not consulted in node_modules).
- /private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/spike-visual/app/layout.tsx:46-52 (MOTION_BOOTSTRAP sets data-motion off/on from prefers-reduced-motion)
- /private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/spike-visual/components/site/IntroCurtain.tsx:11-14 (sessionStorage fc-intro-seen skips the curtain; reduced motion also skips it)
- /private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/spike-visual/app/api/availability/route.ts:12-34 (response shape {today, now, date, booked, capacity} that the spec mocks)
- /private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/spike-visual/lib/motion.tsx:260-312 (rAF scroll loop: translate-based parallax, header auto-hide, hero fade; only runs when motion is on)
- /private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/spike-visual/styles/home.css:54-63 (hero Ken Burns 7s transition)
- /private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/spike-visual/components/site/SiteProvider.tsx:200-225, 520-528 (availability effect uses server clock; hero slide interval gated by readMotionLevel)