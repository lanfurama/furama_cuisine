import type { Page } from '@playwright/test';
import { mockAvailability } from './availability-mock';
import { watchCsp } from './csp';
import { HOME_PATH } from './paths';
import { expect, test } from './staff-fixtures';

/*
 * The guest's overlays are modal (components/site/Chrome.tsx,
 * useModalOverlays): opening one takes the focus to its [data-autofocus]
 * (the Reserve drawer's heading, the search box) and makes the box around the
 * header and the page inert; closing it with Escape gives the focus back to
 * the button that opened it and the page its keyboard again. Availability is
 * mocked: nothing here needs the database.
 */

/* 10:00 on Friday 2 Oct in Da Nang. */
const NOW = new Date('2026-10-02T03:00:00Z');

test.use({ reducedMotion: 'reduce' });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  await page.clock.setFixedTime(NOW);
  await mockAvailability(page, { today: () => '2026-10-02', now: () => NOW.toISOString() });
});

/** What an open overlay makes inert: the plain box around the header and `.page`. */
const behind = (page: Page) => page.locator('.page').locator('xpath=..');

test('the Reserve drawer opens on its heading over an inert page, and Escape gives the focus back to RESERVE', async ({ page }) => {
  const violations = await watchCsp(page);
  await page.goto(HOME_PATH);
  // The header's RESERVE (the full header's on a desktop).
  const reserve = page.getByRole('button', { name: 'RESERVE', exact: true }).filter({ visible: true }).first();
  await expect(behind(page)).not.toHaveAttribute('inert');

  await reserve.click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.drawer-kicker')).toBeFocused();
  await expect(behind(page)).toHaveAttribute('inert');

  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(reserve).toBeFocused();
  await expect(behind(page)).not.toHaveAttribute('inert');
  expect(violations).toEqual([]);
});

test('the search opens on its search box over an inert page, and Escape gives the focus back to SEARCH', async ({ page }) => {
  await page.goto(HOME_PATH);
  const open = page.getByRole('banner').getByRole('button', { name: 'SEARCH', exact: true });

  await open.click();
  const search = page.getByRole('dialog', { name: 'Search', exact: true });
  // At once: the guest can type straight after the click.
  await expect(search.getByRole('textbox', { name: 'Search restaurants, cuisines, places' })).toBeFocused();
  await expect(behind(page)).toHaveAttribute('inert');

  await page.keyboard.press('Escape');
  await expect(search).toBeHidden();
  await expect(open).toBeFocused();
  await expect(behind(page)).not.toHaveAttribute('inert');
});
