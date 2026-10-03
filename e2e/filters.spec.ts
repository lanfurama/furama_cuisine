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

test('search ignores accents and đ, and matches type, cuisine and destination as the database names them', async ({ page }) => {
  await page.goto(HOME_PATH);
  await page.locator('.hdr-full .hdr-link', { hasText: 'SEARCH' }).click();
  const input = page.getByRole('textbox', { name: 'Search restaurants, cuisines, places' });
  const names = page.locator('.search-result-name');
  await input.fill('pho cuon');
  await expect(names).toHaveText(['Phố Cuốn']);
  await input.fill('HAI VAN');
  await expect(names).toHaveText(['Hải Vân Lounge']);
  // A destination name (destination_i18n), and the meta line under each result.
  await input.fill('dining house');
  await expect(names).toHaveText(['Steakhouse The Fan', 'Phố Cuốn', 'Thai Siam Kitchen', 'Hura Izakaya']);
  await expect(page.locator('.search-result-meta').first()).toHaveText('Steak & Wine · 3F · Furama Dining House');
  // A type line (restaurant_i18n.type_label).
  await input.fill('food hall');
  await expect(names).toHaveText(['Yum Food Village']);
  // A cuisine label (cuisine_i18n): "grill" is in The Fan's "Steak & Grill" and in no restaurant's name, type
  // line or destination, so only the labels can find it ("hotpot" also matched ChaoShan Hotpot by name).
  await input.fill('grill');
  await expect(names).toHaveText(['Steakhouse The Fan']);
  await input.fill('zzz');
  await expect(page.locator('.search-none')).toContainText('No matches for “zzz”');
});

test('the finder filters by cuisine id, meal and destination id, and names each chip by its label', async ({ page }) => {
  await page.goto(HOME_PATH);
  const finder = page.getByRole('region', { name: 'Find a restaurant' });
  const pick = async (field: string, option: string) => {
    await finder.getByRole('button', { name: new RegExp(`^${field}`) }).click();
    await finder.getByRole('listbox', { name: field }).getByRole('option', { name: option, exact: true }).click();
  };
  await pick('Cuisine', 'Thai');
  await pick('Occasion', 'Lunch');
  await pick('Destination', 'Furama MM Supercenter');
  await page.getByRole('button', { name: /SHOW RESTAURANTS/ }).click();
  await expect(page.locator('#restaurant-grid .rcard:visible .rcard-name')).toHaveText(['Yum Food Village']);
  await expect(page.locator('.filter-chip')).toHaveText([/^Thai/, /^Lunch/, /^Furama MM Supercenter/]);
});
