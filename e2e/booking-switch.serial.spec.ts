import type { Browser, Page } from '@playwright/test';
import { DETAIL_PATH, HOME_PATH } from './paths';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * restaurants.booking_enabled (spec §5.2; ruling R14). It switches off Tàya
 * House (the default restaurant, with the only detail page), Hải Vân Lounge (a
 * card that only reserves, at the resort, which has a number) and Yum Food
 * Village (the same at MM Supercenter, which has none). Every guest page reads
 * them, so this file runs in the desktop-serial project, after every other
 * spec. The admin save expires the cached catalogue with
 * updateTag('restaurants'); without it the guest pages below would keep their
 * RESERVE buttons. Phase 6 ("Gọi để đặt bàn", R20): a card that cannot
 * reserve offers its number instead, and only a card with no number is inert.
 */

const SWITCHED = ['taya-house', 'hai-van-lounge', 'yum-food-village'];

test.beforeAll(() => seedStaff());
test.afterAll(async () => {
  // Whatever happened below, leave every restaurant bookable in the database.
  await one(`UPDATE restaurants SET booking_enabled = true`);
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
  for (const id of SWITCHED) await setOnline(page, id, false);

  const home = await guest(browser);
  await home.goto(HOME_PATH);
  // Two of the three offers are theirs: only Café Indochine's keeps its button.
  await expect(home.getByRole('button', { name: /VIEW OFFER/ })).toHaveCount(1);
  // Hải Vân Lounge has no page, so its card only reserved: now it offers the resort's number (R20).
  const lounge = home.locator('.rcard:visible', { hasText: 'Hải Vân Lounge' }).first();
  await expect(lounge.locator('.rcard-tag')).toHaveText('Call +84 236 651 9999 →');
  await expect(lounge).not.toHaveAttribute('aria-disabled', 'true');
  // A tap dials that number (a tel: request, which headless Chromium has no app for), and opens no form.
  const dialled = home.waitForRequest((r) => r.url().startsWith('tel:'));
  await lounge.click();
  expect((await dialled).url()).toBe('tel:+842366519999');
  await expect(home.getByRole('dialog', { name: 'Reserve a table' })).toHaveCount(0);
  // Yum Food Village's destination has no number: its card does nothing.
  const card = home.locator('.rcard', { hasText: 'Yum Food Village' }).first();
  await expect(card.locator('.rcard-tag')).toHaveCount(0);
  await expect(card).toHaveAttribute('aria-disabled', 'true');
  // Nor does it look as if it did (GX-6): under the pointer, no hand and no push-in of its picture.
  const shown = home.locator('.rcard:visible', { hasText: 'Yum Food Village' }).first();
  await shown.hover();
  const look = await shown.evaluate(async (el) => {
    const zoom = el.querySelector('.rcard-zoom')!;
    await Promise.all(zoom.getAnimations().map((a) => a.finished)); // the push-in is a 0.9 s transition
    return { cursor: getComputedStyle(el).cursor, zoom: getComputedStyle(zoom).transform };
  });
  expect(look).toEqual({ cursor: 'default', zoom: 'matrix(1, 0, 0, 1, 0, 0)' });
  // Search offers the call for Hải Vân Lounge and nothing for Yum Food Village; V-Senses Cafe still reserves.
  await home.locator('.hdr-full .hdr-link', { hasText: 'SEARCH' }).click();
  await home.locator('.search-chip', { hasText: 'Café & Lounge' }).click();
  await expect(home.locator('.search-result', { hasText: 'Hải Vân Lounge' }).locator('.search-result-action')).toHaveText('Call →');
  await expect(home.locator('.search-result', { hasText: 'V-Senses Cafe' }).locator('.search-result-action')).toHaveText('Reserve →');
  await home.locator('.search-input').fill('yum');
  await expect(home.locator('.search-result', { hasText: 'Yum Food Village' })).toHaveCount(1);
  await expect(home.locator('.search-result', { hasText: 'Yum Food Village' }).locator('.search-result-action')).toHaveCount(0);
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

  for (const id of SWITCHED) await setOnline(page, id, true);
  await detail.reload();
  await expect(detail.getByRole('button', { name: /RESERVE A TABLE/ })).toBeVisible();
  await home.reload();
  await expect(home.getByRole('button', { name: /VIEW OFFER/ })).toHaveCount(3);
  await expect(home.locator('.rcard', { hasText: 'Hải Vân Lounge' }).first().locator('.rcard-tag')).toHaveText('Reserve a table →');
  for (const p of [home, detail, phone]) await p.context().close();
});

test('with every restaurant booking offline, RESERVE opens on whom to call, not on a form that never loads', async ({ page, browser }) => {
  await signInAs(page, STAFF.editor);
  // Eleven in the database, then the twelfth through the admin, whose save expires the cached catalogue.
  await one(`UPDATE restaurants SET booking_enabled = false WHERE id <> 'the-fan'`);
  try {
    await setOnline(page, 'the-fan', false);
    const home = await guest(browser);
    await home.goto(HOME_PATH);
    await expect(home.getByRole('button', { name: /VIEW OFFER/ })).toHaveCount(0);
    await home.getByRole('button', { name: 'RESERVE', exact: true }).first().click();
    const drawer = home.getByRole('dialog', { name: 'Reserve a table' });
    await expect(drawer.getByRole('alert')).toHaveText(
      'Online booking is not available right now. Please call us on +84 236 651 9999 to book a table.',
    );
    await expect(drawer.getByRole('link', { name: '+84 236 651 9999' })).toHaveAttribute('href', 'tel:+842366519999');
    await expect(drawer.getByRole('button', { name: 'REQUEST BOOKING' })).toHaveCount(0);
    await expect(drawer.getByText('Checking tables…')).toHaveCount(0);
    await home.context().close();
  } finally {
    // Back through the same save (R21), which expires the catalogue again.
    await one(`UPDATE restaurants SET booking_enabled = true WHERE id <> 'the-fan'`);
    await setOnline(page, 'the-fan', true);
  }
});
