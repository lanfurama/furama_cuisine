import { expect, test, type Locator, type Page } from '@playwright/test';
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
 * server and showPage set. A build with the hero really hidden was measured
 * once (phase 6 final fix report, F4), and phase 7's hero editor brings the
 * end-to-end test.
 */

test.use({ reducedMotion: 'reduce' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
});

/** Runs in the page: the alpha of a computed colour ("rgba(20, 32, 28, 0)" is 0, "rgb(…)" 1). */
function backgroundAlpha(el: Element): number {
  const parts = (getComputedStyle(el).backgroundColor.match(/[\d.]+/g) ?? []).map(Number);
  return parts.length === 4 ? parts[3] : 1;
}

/** Runs in the page: how far the page's first visible section starts below the visible header's bottom (negative: under it), and which section that is. */
function firstSectionBelowHeader(main: HTMLElement): { gap: number; section: string } {
  const visible = (el: Element) => el.getClientRects().length > 0;
  const header = [...document.querySelectorAll('header')].find(visible);
  const first = [...main.querySelectorAll<HTMLElement>(':scope > section')].find(visible);
  if (!header || !first) throw new Error('no visible header or section');
  return {
    gap: first.getBoundingClientRect().top - header.getBoundingClientRect().bottom,
    section: first.id || first.getAttribute('aria-label') || first.className,
  };
}

/** The page as the server renders it without a hero, hydrated: no #top, and the marks of ViewMarker and showPage. */
async function dropTheHero(home: Locator) {
  await home.evaluate((main: HTMLElement) => {
    main.querySelector('#top')?.remove();
    main.dataset.hero = 'none';
    document.documentElement.dataset.hero = 'none';
  });
}

/** The visible header is solid (and, on desktop, condensed) at the top, and `first` starts below it. */
async function expectSolidAndClear(page: Page, home: Locator, width: number, first: string) {
  const header = page.getByRole('banner');
  await expect.poll(() => header.evaluate(backgroundAlpha)).toBeGreaterThanOrEqual(0.9);
  if (width >= 1080) {
    // The roomy header condenses, as once scrolled.
    const solid = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h-solid')));
    expect(solid).toBe(76);
    await expect.poll(() => header.evaluate((el) => el.getBoundingClientRect().height)).toBe(solid);
  }
  expect((await home.evaluate(firstSectionBelowHeader)).section).toBe(first);
  await expect.poll(async () => (await home.evaluate(firstSectionBelowHeader)).gap).toBeGreaterThanOrEqual(0);
}

const VIEWPORTS = [
  // The finder comes first from 760 px up; on a phone it is Cuisines.
  { width: 1280, height: 860, first: 'Find a restaurant' },
  { width: 900, height: 860, first: 'Find a restaurant' },
  { width: 390, height: 844, first: 'cuisines' },
];

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
