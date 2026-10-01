import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
});

test('page entrances play again after client-side navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.hero-kicker')).toHaveCSS('opacity', '1');

  await page.locator('.rcard', { hasText: 'Tàya House' }).first().click();
  await page.waitForURL('**/taya-house');
  await expect(page.locator('.taya-kicker')).toHaveCSS('opacity', '1');

  await page.locator('.taya-back').click();
  await page.waitForURL((url) => url.pathname === '/');
  await expect(page.locator('.hero-kicker')).toHaveCSS('opacity', '1');
});
