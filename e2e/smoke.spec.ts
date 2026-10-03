import { expect, test } from '@playwright/test';
import { HOME_PATH } from './paths';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
});

test('home page lists the restaurant catalogue', async ({ page }) => {
  await page.goto(HOME_PATH);
  await expect(page.locator('.rcard')).toHaveCount(12);
});

test('the hero has one dot per slide, and a dot shows its slide', async ({ page }) => {
  await page.goto(HOME_PATH);
  // The three slides migration 008 seeds (hero_slides).
  await expect(page.locator('.hero-dots .hero-dot')).toHaveCount(3);
  await page.locator('.hero-dot').nth(1).click();
  await expect(page.locator('.hero-slide').nth(1)).toHaveAttribute('data-active', 'true');
  await expect(page.locator('.hero-slide').nth(0)).toHaveAttribute('data-active', 'false');
});
