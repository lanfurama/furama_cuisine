import type { Page } from '@playwright/test';
import { addDays, formatDay, venueNow } from '../lib/venue-time';
import { GROUP_PHONE, mockAvailability, type MockOptions } from './availability-mock';
import { HOME_PATH } from './paths';
import { expect, one, test } from './staff-fixtures';

/*
 * The guest form on server availability (spec §10.2, phase-4 acceptance
 * "closed days greyed out for guests" and "max_party = 8 blocks 9 guests").
 * The first tests pin the server with a mock; the last three go to the real
 * API and database (one() refuses any database but a local _test one).
 */

/* 10:00 on Friday 2 Oct in Da Nang. */
const NOW = new Date('2026-10-02T03:00:00Z');
const clock = { today: () => '2026-10-02', now: () => NOW.toISOString() };

test.use({ reducedMotion: 'reduce' }); // no reveal animation on the booking bar
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
});

async function openDrawer(page: Page, options: Partial<MockOptions> = {}) {
  await page.clock.setFixedTime(NOW);
  await mockAvailability(page, { ...clock, ...options });
  await page.goto(HOME_PATH);
  await page.getByRole('button', { name: 'RESERVE', exact: true }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.daystrip .day')).toHaveCount(14);
  return drawer;
}

/** The booking bar's dropdowns, in order: destination, restaurant, date, time, guests. */
const barField = (page: Page, i: number) => page.locator('#reserve .dd').nth(i);

test('a closed day is greyed out, cannot be chosen, and says why', async ({ page }) => {
  const drawer = await openDrawer(page, {
    days: {
      '2026-10-04': { state: 'closed', reason: 'Closed for a private event' },
      '2026-10-05': { state: 'closed' },
      '2026-10-06': { state: 'full' },
    },
  });

  const closed = drawer.getByRole('button', { name: 'Sun, 4 Oct: Closed for a private event' });
  await expect(closed).toHaveAttribute('aria-disabled', 'true');
  await expect(closed).toHaveAttribute('data-state', 'closed');
  await expect(closed.locator('.day-num')).toHaveCSS('text-decoration-line', 'line-through');

  // Playwright waits for aria-disabled elements to become enabled; a guest's tap still lands (it is not `disabled`).
  await closed.click({ force: true });
  await expect(closed).toHaveAttribute('aria-pressed', 'false');
  await expect(drawer.locator('.day[aria-pressed="true"] .day-num')).toHaveText('2');
  await expect(drawer.getByRole('status')).toHaveText('Sun, 4 Oct: Closed for a private event');

  // Without a public reason, and when full, the generic words from the registry.
  await expect(drawer.getByRole('button', { name: 'Mon, 5 Oct: Closed' })).toHaveAttribute('aria-disabled', 'true');
  await expect(drawer.getByRole('button', { name: 'Tue, 6 Oct: Fully booked' })).toHaveAttribute('data-state', 'full');

  // An open day still selects.
  await drawer.locator('.day[data-state="open"]', { hasText: '7' }).click();
  await expect(drawer.locator('.day[aria-pressed="true"] .day-num')).toHaveText('7');
  await expect(drawer.getByRole('status')).toHaveCount(0);

  // The booking bar's date list greys the same days and shows the reason on hover.
  await page.keyboard.press('Escape');
  await barField(page, 2).locator('.dd-trigger').click();
  const option = page.getByRole('option', { name: /Sun, 4 Oct/ });
  await expect(option).toHaveAttribute('aria-disabled', 'true');
  await expect(option).toHaveAttribute('title', 'Closed for a private event');
  await expect(option.locator('.dd-note')).toHaveText('Closed');
  await option.click({ force: true });
  await expect(barField(page, 2).locator('.dd-value-text')).toHaveText('Wed, 7 Oct');
});

test('a closure of one meal keeps the rest of the day bookable', async ({ page }) => {
  const drawer = await openDrawer(page, { mealClosures: { '2026-10-02': { Lunch: 'Staff training' } } });

  const lunch = drawer.locator('.slotgroup', { hasText: 'Lunch' });
  await expect(lunch.locator('.slotgroup-note')).toHaveText('Not available on this date.Staff training');
  await expect(lunch.locator('.slot')).toHaveCount(0);
  await expect(drawer.locator('.slotgroup', { hasText: 'Dinner' }).locator('.slot:not([disabled])')).toHaveCount(7);
});

test('the party limit comes from the server: max_party 8 blocks a ninth guest and says whom to call', async ({ page }) => {
  const drawer = await openDrawer(page, { maxParty: 8 });

  const more = drawer.getByRole('button', { name: 'More guests' });
  for (let i = 2; i < 8; i++) await more.click();
  await expect(drawer.locator('.guests-value')).toHaveText('8 guests');
  await expect(more).toBeDisabled();
  await expect(drawer.locator('.guests-hint')).toHaveText(
    `For more than 8 guests, please call us on ${GROUP_PHONE.display}.`,
  );
  await expect(drawer.locator('.guests-hint a')).toHaveAttribute('href', `tel:${GROUP_PHONE.tel}`);

  await drawer.getByRole('button', { name: 'Fewer guests' }).click();
  await expect(drawer.locator('.guests-hint')).toHaveCount(0);

  // The booking bar offers 1…8 and nothing above.
  await page.keyboard.press('Escape');
  await barField(page, 4).locator('.dd-trigger').click();
  const options = page.getByRole('listbox', { name: 'Guests' }).getByRole('option');
  await expect(options).toHaveCount(8);
  await expect(options.last()).toHaveText(/8 guests/);
});

test('books a table against the real availability API', async ({ page }) => {
  await page.goto(HOME_PATH);
  await page.getByRole('button', { name: 'RESERVE', exact: true }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.daystrip .day')).toHaveCount(14);
  await expect(drawer.locator('.daystrip .day').first().locator('.day-wd')).toHaveText('Today');

  // The last day of the window is never past its sittings.
  await drawer.locator('.daystrip .day[data-state="open"]').last().click();
  await drawer.locator('.slot:not([disabled])').first().click();
  await drawer.getByLabel('Full name *', { exact: true }).fill('Nguyễn Minh Anh');
  const digits = String(Date.now()).slice(-6);
  await drawer.getByLabel('Phone *', { exact: true }).fill(`0905 ${digits.slice(0, 3)} ${digits.slice(3)}`);
  await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();

  await expect(drawer.locator('.drawer-ref')).toHaveText(/^FC-[0-9A-HJKMNP-TV-Z]{8}$/);
});

/** Opens the drawer from a home-page card (a restaurant without its own page only reserves). */
async function openFromCard(page: Page, name: string) {
  await page.goto(HOME_PATH);
  await page.locator('.rcard:visible', { hasText: name }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.daystrip .day')).toHaveCount(14);
  return drawer;
}

test('a closure written to the database greys the day on the next calendar fetch', async ({ page }) => {
  const date = addDays(venueNow().date, 9);
  const closure = await one<{ id: string }>(
    `INSERT INTO closures (scope, restaurant_id, starts_on, ends_on, created_by) VALUES ('restaurant', 'don-ciprianis', $1, $1, 'e2e') RETURNING id::text`,
    [date],
  );
  try {
    await one(`INSERT INTO closure_i18n (closure_id, locale, public_reason) VALUES ($1, 'en', 'Closed for a wine dinner')`, [closure!.id]);
    const drawer = await openFromCard(page, 'Don Cipriani');
    const chip = drawer.locator('.daystrip .day[aria-disabled="true"]');
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveAttribute('data-state', 'closed');
    await expect(chip).toHaveAttribute('aria-label', `${formatDay(date).label}: Closed for a wine dinner`);
  } finally {
    await one('DELETE FROM closures WHERE id = $1', [closure!.id]);
  }
});

test('a max_party of 8 in the database stops the stepper at 8 and names the destination’s number', async ({ page }) => {
  await one(`UPDATE restaurants SET max_party = 8 WHERE id = 'the-fan'`);
  try {
    const drawer = await openFromCard(page, 'Steakhouse The Fan');
    const more = drawer.getByRole('button', { name: 'More guests' });
    for (let i = 2; i < 8; i++) await more.click();
    await expect(drawer.locator('.guests-value')).toHaveText('8 guests');
    await expect(more).toBeDisabled();
    await expect(drawer.locator('.guests-hint')).toHaveText('For more than 8 guests, please call us on 0859 555 759.');
    await expect(drawer.locator('.guests-hint a')).toHaveAttribute('href', 'tel:+84859555759');
  } finally {
    await one(`UPDATE restaurants SET max_party = NULL WHERE id = 'the-fan'`);
  }
});
