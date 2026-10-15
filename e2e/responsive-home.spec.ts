import { expect, test, type Page } from '@playwright/test';
import { HOME_PATH } from './paths';

/*
 * The home page on the screens it failed on (styles/home.css). A phone on its
 * side showed only the photograph: the 460px hero ran under the tab bar and the
 * headline below the screen. Two restaurant cards across a phone on its side
 * or a small tablet were each half the screen tall, and the third offer sat
 * alone at the left of a two-card row. On a 2560px screen the Experiences rows
 * ran to the window's edge, their arrows a thousand pixels from their words.
 * The finder cut "Any destination" to an ellipsis from 1080 to 1194px, and a
 * slide's dot was 18px wide to a finger.
 */

test.use({ reducedMotion: 'reduce' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
});

/** Where `selector`'s first visible match sits in the viewport. */
function box(page: Page, selector: string) {
  return page
    .locator(selector)
    .filter({ visible: true })
    .first()
    .evaluate((el) => {
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width };
    });
}

/** The bottom of the visible header, and the top of the tab bar when one shows (else the screen's foot). */
function bars(page: Page) {
  return page.evaluate(() => {
    const shown = (el: Element) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const header = [...document.querySelectorAll('header')].find(shown);
    const tabbar = [...document.querySelectorAll('nav.tabbar')].find(shown);
    return { headerBottom: header ? header.getBoundingClientRect().bottom : 0, floor: tabbar ? tabbar.getBoundingClientRect().top : innerHeight };
  });
}

/** How many columns the restaurant grid lays out. */
function gridColumns(page: Page) {
  return page.locator('#restaurant-grid').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
}

for (const { width, height, cta } of [
  { width: 568, height: 320, cta: '.hero-find' },
  { width: 750, height: 342, cta: '.hero-find' },
  { width: 863, height: 360, cta: '.hero-explore' },
]) {
  test.describe(`a phone on its side (${width} × ${height})`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true });

    test('the headline and its button are whole on the first screen, between the bars', async ({ page }) => {
      await page.goto(HOME_PATH);
      await expect(page.locator('#top h1.hero-title')).toBeVisible();
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      const { headerBottom, floor } = await bars(page);
      expect((await box(page, '#top .hero-kicker')).top).toBeGreaterThanOrEqual(headerBottom);
      expect((await box(page, '#top .hero-title')).bottom).toBeLessThanOrEqual(floor);
      expect((await box(page, `#top ${cta}`)).bottom).toBeLessThanOrEqual(floor);
    });

    test('the hero shows the wide photograph, not the upright phone crop', async ({ page }) => {
      await page.goto(HOME_PATH);
      const img = page.locator('#top .hero-slide').first().locator('img');
      await expect(img).toBeVisible();
      // The <img>'s own srcset is the desktop file's; a matching <source> (the phone crop) would win over it.
      await expect
        .poll(() => img.evaluate((el: HTMLImageElement) => el.currentSrc !== '' && el.srcset.includes(el.currentSrc.replace(location.origin, ''))))
        .toBe(true);
    });
  });
}

test.describe('a small tablet upright (712 × 1138)', () => {
  test.use({ viewport: { width: 712, height: 1138 }, isMobile: true, hasTouch: true });

  test('the restaurants come three across', async ({ page }) => {
    await page.goto(HOME_PATH);
    await expect(page.locator('#restaurant-grid')).toBeVisible();
    expect(await gridColumns(page)).toBe(3);
  });
});

test('a phone upright keeps two restaurants across', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(HOME_PATH);
  await expect(page.locator('#restaurant-grid')).toBeVisible();
  expect(await gridColumns(page)).toBe(2);
});

test.describe('an iPad upright (834 × 1194)', () => {
  test.use({ viewport: { width: 834, height: 1194 }, isMobile: true, hasTouch: true });

  test('an odd last offer sits centred under the pair, as wide as one', async ({ page }) => {
    await page.goto(HOME_PATH);
    const offers = page.locator('#offers .offer');
    const count = await offers.count();
    test.skip(count < 3 || count % 2 === 0, 'needs an odd number of offers, three or more');
    const grid = await box(page, '#offers .offers-grid');
    const first = await offers.first().boundingBox();
    const last = await offers.last().boundingBox();
    expect(Math.abs(last!.width - first!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(last!.x + last!.width / 2 - (grid.left + grid.width / 2))).toBeLessThanOrEqual(1);
  });

  test('a slide’s dot is a finger’s width (24px and more)', async ({ page }) => {
    await page.goto(HOME_PATH);
    const dots = page.locator('#top .hero-dot');
    test.skip((await dots.count()) < 2, 'needs two slides or more');
    for (const width of await dots.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width))) {
      expect(width).toBeGreaterThanOrEqual(24);
    }
  });
});

test('on a 2560px screen the Experiences rows end where the restaurant grid does', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.goto(HOME_PATH);
  await expect(page.locator('#experiences .experiences-list')).toBeAttached();
  const list = await box(page, '#experiences .experiences-list');
  const grid = await box(page, '#restaurant-grid');
  expect(Math.abs(list.right - grid.right)).toBeLessThanOrEqual(1);
});

for (const width of [1080, 1194]) {
  test(`at ${width}px the finder cuts none of its values`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(HOME_PATH);
    await expect(page.locator('.finder .finder-fields')).toBeVisible();
    const cut = await page
      .locator('.finder .dd-value-text')
      .evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent));
    expect(cut).toEqual([]);
  });
}
