import type { Browser, Page } from '@playwright/test';
import { DETAIL_PATH, HOME_PATH } from './paths';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * restaurants.booking_enabled (spec §5.2; ruling R14). It switches off Tàya
 * House (the default restaurant, with the only detail page) and Hải Vân
 * Lounge (a card that only reserves), which every guest page reads, so this
 * file runs in the desktop-serial project, after every other spec. The admin
 * save expires the cached catalogue with updateTag('restaurants'); without it
 * the guest pages below would keep their RESERVE buttons.
 */

test.beforeAll(() => seedStaff());
test.afterAll(async () => {
  // Whatever happened above, leave both restaurants bookable in the database.
  await one(`UPDATE restaurants SET booking_enabled = true WHERE id IN ('taya-house', 'hai-van-lounge')`);
});

async function setOnline(page: Page, id: string, on: boolean) {
  await page.goto(`/admin/restaurants/${id}/booking`);
  const rules = page.getByRole('form', { name: 'Quy tắc đặt bàn' });
  await rules.getByRole('checkbox', { name: /^Nhận đặt bàn online/ }).setChecked(on);
  await rules.getByRole('button', { name: 'Lưu quy tắc' }).click();
  await expect(page.getByRole('form', { name: 'Quy tắc đặt bàn' }).getByRole('status')).toHaveText('Đã lưu.');
}

/** A guest with no staff cookie, past the intro. */
async function guest(browser: Browser, viewport = { width: 1280, height: 860 }) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  return context.newPage();
}

test('switching online booking off hides every RESERVE of that restaurant; on again brings them back', async ({ page, browser }) => {
  await signInAs(page, STAFF.editor);
  await setOnline(page, 'taya-house', false);
  await setOnline(page, 'hai-van-lounge', false);

  const home = await guest(browser);
  await home.goto(HOME_PATH);
  // Two of the three offers are theirs: only Café Indochine's keeps its button.
  await expect(home.getByRole('button', { name: /VIEW OFFER/ })).toHaveCount(1);
  // Hải Vân Lounge has no page, so its card only reserved: now it does nothing.
  const card = home.locator('.rcard', { hasText: 'Hải Vân Lounge' }).first();
  await expect(card.locator('.rcard-tag')).toHaveCount(0);
  await expect(card).toHaveAttribute('aria-disabled', 'true');
  // Search names no action for it; V-Senses Cafe still reserves (phase-2 ledger: the View/Reserve label).
  await home.locator('.hdr-full .hdr-link', { hasText: 'SEARCH' }).click();
  await home.locator('.search-chip', { hasText: 'Café & Lounge' }).click();
  await expect(home.locator('.search-result', { hasText: 'Hải Vân Lounge' }).locator('.search-result-action')).toHaveCount(0);
  await expect(home.locator('.search-result', { hasText: 'V-Senses Cafe' }).locator('.search-result-action')).toHaveText('Reserve →');
  await home.keyboard.press('Escape');
  // The generic RESERVE opens on the first bookable restaurant, and the list leaves both out.
  await home.getByRole('button', { name: 'RESERVE', exact: true }).first().click();
  const drawer = home.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.drawer-name')).toHaveText('Café Indochine');
  await drawer.locator('.dd').nth(1).locator('.dd-trigger').click();
  const names = await drawer.getByRole('listbox', { name: 'Restaurant' }).getByRole('option').allTextContents();
  expect(names.join('|')).not.toMatch(/Tàya House|Hải Vân Lounge/);
  expect(names).toHaveLength(4); // the resort's others: Café Indochine, Don Cipriani’s, Danaksara, V-Senses Cafe

  const detail = await guest(browser);
  await detail.goto(DETAIL_PATH);
  await expect(detail.locator('.taya-kicker')).toBeVisible();
  await expect(detail.getByRole('button', { name: /RESERVE A TABLE/ })).toHaveCount(0);

  const phone = await guest(browser, { width: 390, height: 844 });
  await phone.goto(DETAIL_PATH);
  const bar = phone.getByRole('navigation', { name: 'Restaurant actions' });
  await expect(bar.getByRole('button', { name: 'RESERVE' })).toHaveCount(0);
  await expect(bar).toHaveAttribute('style', /repeat\(3, minmax\(0, 1fr\)\)/); // CALL, MAP, MENU

  await setOnline(page, 'taya-house', true);
  await setOnline(page, 'hai-van-lounge', true);
  await detail.reload();
  await expect(detail.getByRole('button', { name: /RESERVE A TABLE/ })).toBeVisible();
  await home.reload();
  await expect(home.getByRole('button', { name: /VIEW OFFER/ })).toHaveCount(3);
  await expect(home.locator('.rcard', { hasText: 'Hải Vân Lounge' }).first().locator('.rcard-tag')).toHaveText('Reserve a table →');
  for (const p of [home, detail, phone]) await p.context().close();
});
