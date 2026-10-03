import { DETAIL_PATH } from './paths';
import { expect, test } from './staff-fixtures';

/*
 * Tàya House's page, read from the database since phase 6 (its pixels are
 * the visual baselines). Reads only.
 */

const TARIFF = 'https://furamavietnam.com/wp-content/uploads/2026/03/Taya-CC-Tariff-A4-1-25.pdf';

test.use({ reducedMotion: 'reduce' });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
});

test('the page carries its own title, description, CALL and MAP from the database', async ({ page }) => {
  await page.goto(DETAIL_PATH);
  await expect(page).toHaveTitle('Tàya House — Furama Cuisine');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /^A wellness dining home beneath the Lagoon Garden/);
  const hero = page.locator('.taya-hero-copy');
  // The resort's: Tàya House has neither of its own (spec §6.4).
  await expect(hero.getByRole('link', { name: 'CALL' })).toHaveAttribute('href', 'tel:+842366519999');
  await expect(hero.getByRole('link', { name: 'MAP' })).toHaveAttribute('href', 'https://maps.google.com/?q=Furama+Resort+Danang');
  await expect(page.getByRole('heading', { name: 'More at Furama Resort Danang' })).toBeVisible();
});

test('MENU opens the menu PDF in a new tab and leaves the page where it was', async ({ page, context }) => {
  // Never reach the real host: the new tab gets a stand-in (text, so headless Chromium shows it rather than downloading it).
  await context.route(TARIFF, (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: 'tariff' }));
  await page.goto(DETAIL_PATH);
  const popup = context.waitForEvent('page');
  await page.locator('.taya-hero-copy').getByRole('button', { name: 'MENU' }).click();
  const tab = await popup;
  await tab.waitForURL(TARIFF);
  expect(await tab.evaluate(() => window.opener)).toBeNull();
  // The highlights are the fallback for a blocked popup only: the page has not moved.
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});
