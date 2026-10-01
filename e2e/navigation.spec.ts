import { expect, test } from '@playwright/test';
import { DETAIL_PATH, HOME_PATH } from './paths';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
});

test('page entrances play again after client-side navigation', async ({ page }) => {
  await page.goto(HOME_PATH);
  await expect(page.locator('.hero-kicker')).toHaveCSS('opacity', '1');

  await page.locator('.rcard', { hasText: 'Tàya House' }).first().click();
  await page.waitForURL((url) => url.pathname === DETAIL_PATH);
  await expect(page.locator('.taya-kicker')).toHaveCSS('opacity', '1');

  await page.locator('.taya-back').click();
  await page.waitForURL((url) => url.pathname === HOME_PATH);
  await expect(page.locator('.hero-kicker')).toHaveCSS('opacity', '1');
});
