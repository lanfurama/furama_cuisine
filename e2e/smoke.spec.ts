import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
});

test('home page lists the restaurant catalogue', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.rcard')).toHaveCount(12);
});
