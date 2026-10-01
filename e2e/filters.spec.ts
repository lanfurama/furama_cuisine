import { expect, test } from '@playwright/test';
import { HOME_PATH } from './paths';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
});

test('a cuisine chip filters the grid by its key and names the filter by its label', async ({ page }) => {
  await page.goto(HOME_PATH);
  await page.locator('.cuisine', { hasText: 'Steak & Grill' }).click();
  await expect(page.locator('#restaurant-grid .rcard:visible')).toHaveCount(1);
  await expect(page.locator('#restaurant-grid .rcard:visible')).toContainText('Steakhouse The Fan');
  await expect(page.locator('.filter-chip')).toContainText('Steak & Grill');
});

test('search matches a cuisine by its label', async ({ page }) => {
  await page.goto(HOME_PATH);
  await page.locator('.hdr-full .hdr-link', { hasText: 'SEARCH' }).click();
  await page.locator('.search-chip', { hasText: 'Café & Lounge' }).click();
  await expect(page.locator('.search-result')).toHaveCount(2);
  await expect(page.locator('.search-result-name')).toHaveText(['V-Senses Cafe', 'Hải Vân Lounge']);
});
