import { expect, test, type Page } from '@playwright/test';
import { HOME_PATH } from './paths';

/*
 * The hero's copy sits at the hero's foot (styles/home.css), under a fixed,
 * transparent header. On a wide but short window (a laptop's: 1366 × 768,
 * 1280 × 720) the copy used to be taller than the hero and ran up under the
 * header, the headline over the logo and the menu. The headline now follows
 * the window's height as well as its width, and when the copy still does not
 * fit (the longest lines staff may write, which wrap) the hero grows instead.
 */

test.use({ reducedMotion: 'reduce' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
});

const WINDOWS = [
  { width: 1920, height: 1080 },
  { width: 1900, height: 830 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
  { width: 1080, height: 700 },
  { width: 1024, height: 600 },
  { width: 390, height: 844 },
];

/** How far the hero's first line (the kicker) starts below the visible header's bottom (negative: under it). */
function kickerBelowHeader(page: Page) {
  return page.evaluate(() => {
    const header = [...document.querySelectorAll('header')].find((el) => el.getClientRects().length > 0);
    const kicker = document.querySelector('#top .hero-kicker');
    if (!header || !kicker) throw new Error('no visible header or hero kicker');
    return kicker.getBoundingClientRect().top - header.getBoundingClientRect().bottom;
  });
}

for (const { width, height } of WINDOWS) {
  test(`at ${width} × ${height}, the hero's copy starts below the header`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(HOME_PATH);
    await expect(page.locator('#top h1.hero-title')).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await kickerBelowHeader(page)).toBeGreaterThanOrEqual(16);
  });
}

test('the longest headline and lede staff may write still start below the header', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(HOME_PATH);
  await expect(page.locator('#top h1.hero-title')).toBeVisible();
  const before = await page.locator('#top').evaluate((el) => el.getBoundingClientRect().height);
  // Registry maxLength: 28 characters a title line, 160 for the lede (lib/i18n/registry.ts).
  await page.evaluate(() => {
    document.querySelectorAll('#top .hero-line').forEach((line) => (line.textContent = 'Hương vị tinh tế bốn phương'));
    const lede = document.querySelector('#top .hero-lede');
    if (lede) lede.textContent = 'Từ những bữa tối bên bờ biển đến các điểm đến sôi động giữa lòng thành phố – khám phá nhà hàng, ẩm thực và con người của Furama Cuisine.';
  });
  expect(await kickerBelowHeader(page)).toBeGreaterThanOrEqual(16);
  // The lines wrap at this width: the hero made room by growing.
  expect(await page.locator('#top').evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(before);
});
