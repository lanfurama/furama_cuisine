import { expect, test, type Page } from '@playwright/test';
import { DETAIL_PATH, HOME_PATH } from './paths';

/*
 * The restaurant page and the booking bar on the screens they failed on
 * (styles/detail.css, styles/booking.css). A phone on its side showed only
 * the photo: the name sat below the screen, under the tab bar. A big phone on
 * its side and a short laptop cut the arch, and RESERVE A TABLE was below the
 * screen. The booking bar took five rows on a phone on its side, and at
 * 1194 px (an iPad Pro on its side) cut "Furama Resort Danang" to an ellipsis.
 * One highlight filled the whole width with a single photograph.
 */

test.use({ reducedMotion: 'reduce' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
});

/** Where `selector`'s first match sits in the viewport. */
function box(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom };
    });
}

/** How many rows the booking bar's fields take. */
function fieldRows(page: Page) {
  return page.locator('#reserve .booking-fields > .dd').evaluateAll((els) => new Set(els.map((el) => Math.round(el.getBoundingClientRect().top))).size);
}

test.describe('a phone on its side (750 × 342)', () => {
  test.use({ viewport: { width: 750, height: 342 }, isMobile: true, hasTouch: true });

  test('the restaurant name shows above the tab bar on the first screen', async ({ page }) => {
    await page.goto(DETAIL_PATH);
    await expect(page.locator('.taya-title-m')).toBeVisible();
    const name = await box(page, '.taya-title-m');
    const tabbar = await box(page, '.tabbar-detail');
    expect(name.top).toBeGreaterThanOrEqual(0);
    expect(name.bottom).toBeLessThanOrEqual(tabbar.top);
  });

  test('the booking bar takes two rows of fields, not five', async ({ page }) => {
    await page.goto(HOME_PATH);
    await expect(page.locator('#reserve .booking-fields')).toBeAttached();
    expect(await fieldRows(page)).toBe(2);
  });
});

test.describe('a big phone on its side (863 × 360)', () => {
  test.use({ viewport: { width: 863, height: 360 }, isMobile: true, hasTouch: true });

  test('the name, RESERVE A TABLE and the whole arch fit the first screen', async ({ page }) => {
    await page.goto(DETAIL_PATH);
    await expect(page.locator('.taya-title')).toBeVisible();
    for (const selector of ['.taya-title', '.taya-reserve', '.taya-portrait']) {
      expect((await box(page, selector)).bottom, selector).toBeLessThanOrEqual(360);
    }
  });
});

test('on a short laptop (1280 × 720) the whole arch is on the first screen', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(DETAIL_PATH);
  await expect(page.locator('.taya-portrait')).toBeVisible();
  expect((await box(page, '.taya-portrait')).bottom).toBeLessThanOrEqual(720);
});

test('at 1194 px the one-row booking bar cuts no name, and its button fits its words', async ({ page }) => {
  await page.setViewportSize({ width: 1194, height: 834 });
  await page.goto(HOME_PATH);
  await expect(page.locator('#reserve .booking-fields')).toBeAttached();
  expect(await fieldRows(page)).toBe(1);
  const cut = await page
    .locator('#reserve .dd-value-text')
    .evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent));
  expect(cut).toEqual([]);
  expect(await page.locator('#reserve .booking-submit').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test('a single highlight keeps a card’s size instead of filling the row', async ({ page }) => {
  await page.goto(DETAIL_PATH);
  const rail = page.locator('.dishes-rail');
  await expect(rail).toBeVisible();
  // As a restaurant with one highlight renders it: the others taken out of the row.
  const [railWidth, cardWidth] = await rail.evaluate((el) => {
    [...el.children].slice(1).forEach((card) => card.remove());
    return [el.clientWidth, el.firstElementChild!.getBoundingClientRect().width];
  });
  expect(cardWidth).toBeLessThan(railWidth / 3);
});
