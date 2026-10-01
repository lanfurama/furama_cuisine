import { expect, test, type Page } from '@playwright/test';
import { PAGES } from './paths';

/**
 * Full-page screenshots of every guest page, compared pixel for pixel with the
 * baselines in e2e/__visual__/ (taken from the code before phase 2).
 * VISUAL_SUFFIX lets a run hit the same page under a different URL (used to
 * prove the comparison works across URLs: VISUAL_SUFFIX='?x=1').
 */
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
