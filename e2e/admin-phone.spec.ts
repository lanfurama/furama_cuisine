import type { Page } from '@playwright/test';
import { expectHydrated } from './csp';
import { seedReservation, venueDay } from './reservation-fixtures';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * The admin on a phone (UX-6): at 375 px no screen is wider than the
 * viewport, with every <details> open (pickers, uploaders, contexts), so
 * nothing scrolls sideways; a wide table scrolls inside its own box. First
 * the phase-7A editors, then the screens the admin redesign reworked, with
 * a booking of this file's own (Hura Izakaya, +9: no other spec books there)
 * so the inbox and the day sheet have a row. And on a desktop the inbox's
 * table fits its column, with no scroller of its own.
 */

const SCREENS = ['/admin/content/hero', '/admin/restaurants', '/admin/restaurants/taya-house', '/admin/content/sections', '/admin/media'];

const RESTAURANT = 'hura-izakaya';
const DATE = venueDay(9);
const GUEST = 'Khách màn điện thoại E2E';

/** The screens whose page is wider than the viewport, with how wide. */
async function widerThan(page: Page, width: number, paths: readonly string[]): Promise<string[]> {
  const wide: string[] = [];
  for (const path of paths) {
    await page.goto(path);
    await expectHydrated(page);
    await page.locator('details').evaluateAll((all) => all.forEach((d) => ((d as HTMLDetailsElement).open = true)));
    const scrollWidth = await page.evaluate(() => document.scrollingElement?.scrollWidth ?? 0);
    if (scrollWidth > width) wide.push(`${path}: ${scrollWidth}px`);
  }
  return wide;
}

const clearOwn = () => one(`DELETE FROM reservations WHERE guest_name = $1`, [GUEST]);

test.beforeAll(async () => {
  await seedStaff();
  await clearOwn();
  await seedReservation({ restaurant: RESTAURANT, date: DATE, name: GUEST });
});
test.afterAll(() => clearOwn());

test.describe('on a 375 px phone', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('the 7A screens fit a 375 px phone with every details open', async ({ page }) => {
    await signInAs(page, STAFF.editor);
    expect(await widerThan(page, 375, SCREENS)).toEqual([]);
  });

  test('the overview, the inbox, the day sheet, staff, the log and AI settings fit a 375 px phone', async ({ page }) => {
    // Staff, the log and AI settings are the Admin's.
    await signInAs(page, STAFF.admin);
    const screens = [
      '/admin',
      '/admin/reservations',
      `/admin/reservations/day?ngay=${DATE}&nha_hang=${RESTAURANT}`,
      '/admin/users',
      '/admin/audit',
      '/admin/settings/ai',
    ];
    expect(await widerThan(page, 375, screens)).toEqual([]);
  });
});

test.describe('on a desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the inbox’s table fits a 1280 px window without scrolling sideways', async ({ page }) => {
    await signInAs(page, STAFF.editor);
    expect(await widerThan(page, 1280, ['/admin/reservations', '/admin/reservations?tab=upcoming'])).toEqual([]);
    const table = page.getByRole('main').getByRole('table');
    await expect(table.getByRole('row').first()).toBeVisible();
    // The box around the table (.a-table-scroll) scrolls only when the table is wider than the column.
    const boxes = await table.evaluateAll((all) =>
      all.map((t) => {
        const box = t.parentElement!;
        return { scrollWidth: box.scrollWidth, clientWidth: box.clientWidth };
      }),
    );
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth);
  });
});
