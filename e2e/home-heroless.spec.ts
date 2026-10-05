import { expect, test, type Locator } from '@playwright/test';
import { expectSolidAndClear, VIEWPORTS } from './hero-checks';
import { HOME_PATH } from './paths';

/*
 * A home page without its hero: sections.hero switched off, no slide
 * published, or every slide's picture deleted (homeSections leaves 'hero'
 * out). Nothing dark sits under the header then, and the header's own text is
 * the colour of the page, so the page marks itself and the CSS answers
 * (styles/layout.css):
 * - the server renders <main data-view="home" data-hero="none"> (ViewMarker),
 *   and showPage sets html[data-hero="none"] while that page is on screen;
 * - the header is solid and condensed from the top, as on the policy page;
 * - the first section starts below the fixed header, not under it.
 *
 * This spec checks that CSS contract and writes nothing to the database. In
 * phase 6 no save and no cron expires content:hero, content:sections or
 * media, so a spec could not hide the hero and put it back the R21 way: it
 * takes the hero out in the browser instead and sets exactly the marks the
 * server and showPage set. Phase 7's editors hide it for real
 * (e2e/content-hero.serial.spec.ts, L7-1) with the same checks (./hero-checks.ts).
 */

test.use({ reducedMotion: 'reduce' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
});

/** The page as the server renders it without a hero, hydrated: no #top, and the marks of ViewMarker and showPage. */
async function dropTheHero(home: Locator) {
  await home.evaluate((main: HTMLElement) => {
    main.querySelector('#top')?.remove();
    main.dataset.hero = 'none';
    document.documentElement.dataset.hero = 'none';
  });
}

for (const { width, height, first } of VIEWPORTS) {
  test(`at ${width} px, a home page without its hero has a solid header from the top and starts below it`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(HOME_PATH);
    await expect(page.locator('html')).toHaveAttribute('data-view', 'home');
    const home = page.locator('main[data-view="home"]');
    await expect(home).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    await dropTheHero(home);
    await expectSolidAndClear(page, home, width, first);

    // Before hydration the server HTML holds one page and <html> has no data-view yet: :has() on that <main> decides.
    await page.evaluate(() => {
      delete document.documentElement.dataset.view;
      delete document.documentElement.dataset.hero;
    });
    await expectSolidAndClear(page, home, width, first);
  });
}
