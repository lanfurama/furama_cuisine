import type { Locator, Page } from '@playwright/test';
import { expectHydrated, watchCsp } from './csp';
import { reservationRow, seedReservation, venueDay, type SeededReservation } from './reservation-fixtures';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * The overview's two short lists (app/admin/(shell)/page.tsx). "Chờ xác
 * nhận": the requests, soonest sitting first, each with "Xác nhận" in place.
 * "Hôm nay": today's bookings that hold seats, each with its status and no
 * button, so a request for today is never offered twice under one name. Each
 * list says how many more there are, from the count above it, and leads to
 * the inbox or the day sheet. Checked by reference, never by a total: other
 * specs add bookings beside this one. This file's bookings are at Hura
 * Izakaya: a request dated 2000-01-03, so it sorts first among the requests,
 * and one for today at 00:00, so it sorts first today; both go before and
 * after the file.
 */

const RESTAURANT = 'hura-izakaya';
const GUEST = 'Khách tổng quan E2E';
const LONG_AGO = '2000-01-03';

const clearOwn = () => one(`DELETE FROM reservations WHERE guest_name LIKE $1`, [`${GUEST}%`]);

let oldest: SeededReservation;
let today: SeededReservation;

test.beforeAll(async () => {
  await seedStaff();
  await clearOwn();
  oldest = await seedReservation({ restaurant: RESTAURANT, date: LONG_AGO, time: '19:00', name: `${GUEST} cũ` });
  today = await seedReservation({ restaurant: RESTAURANT, date: venueDay(0), time: '00:00', name: `${GUEST} hôm nay` });
});
test.afterAll(() => clearOwn());

const main = (page: Page) => page.getByRole('main');
const panel = (page: Page, name: 'Chờ xác nhận' | 'Hôm nay') => main(page).getByRole('region', { name, exact: true });
const line = (list: Locator, reference: string) => list.getByRole('listitem').filter({ hasText: reference });

test('a request is confirmed from "Chờ xác nhận" and leaves it; "Hôm nay" shows the status, with no button', async ({ page }) => {
  const violations = await watchCsp(page);
  await signInAs(page, STAFF.editor);
  await expectHydrated(page);
  const pending = panel(page, 'Chờ xác nhận');
  const todays = panel(page, 'Hôm nay');

  const first = line(pending, oldest.reference);
  await expect(first.getByRole('link', { name: `${GUEST} cũ`, exact: true })).toHaveAttribute('href', `/admin/reservations/${oldest.id}`);
  const confirm = first.getByRole('button', { name: `Xác nhận ${oldest.reference}`, exact: true });
  await expect(confirm).toBeVisible();

  // Today's request: its status in "Hôm nay"; its "Xác nhận", if any, only in the requests' list.
  await expect(line(todays, today.reference)).toContainText('Chờ xác nhận');
  await expect(todays.getByRole('button')).toHaveCount(0);
  const todaysConfirm = main(page).getByRole('button', { name: `Xác nhận ${today.reference}`, exact: true });
  expect(await todaysConfirm.count()).toBeLessThanOrEqual(1);

  await confirm.click();
  await expect(line(pending, oldest.reference)).toHaveCount(0);
  expect((await reservationRow(oldest.id)).status).toBe('confirmed');
  await expect(main(page).getByRole('alert')).toHaveCount(0);
  expect(violations).toEqual([]);
});

test('each list says how many more there are, from the count above it', async ({ page }) => {
  await signInAs(page, STAFF.editor);
  // One render: the counts and the lists come from the same response.
  for (const [name, testId] of [
    ['Chờ xác nhận', 'pending-count'],
    ['Hôm nay', 'today-count'],
  ] as const) {
    const total = Number.parseInt((await main(page).getByTestId(testId).textContent()) ?? '', 10);
    const shown = await panel(page, name).getByRole('listitem').count();
    expect(shown, name).toBeGreaterThan(0);
    expect(shown, name).toBeLessThanOrEqual(total);
    const more = panel(page, name).getByRole('link', { name: /^Và \d+ / });
    if (total > shown) await expect(more, name).toHaveText(new RegExp(`^Và ${total - shown} .*khác`));
    else await expect(more, name).toHaveCount(0);
  }
});

test('the panels lead to the inbox ("Hộp thư") and the day sheet ("Theo ngày")', async ({ page }) => {
  await signInAs(page, STAFF.editor);
  await expect(panel(page, 'Chờ xác nhận').getByRole('link', { name: 'Hộp thư', exact: true })).toHaveAttribute('href', '/admin/reservations');
  const day = panel(page, 'Hôm nay').getByRole('link', { name: 'Theo ngày', exact: true });
  await expect(day).toHaveAttribute('href', '/admin/reservations/day');
  // The words the section's own tabs use, not the redesign's first ones.
  await expect(main(page).getByRole('link', { name: 'Bảng theo ngày' })).toHaveCount(0);
  await expect(main(page).getByRole('heading', { name: 'Cần xác nhận' })).toHaveCount(0);

  await day.click();
  await expect(page).toHaveURL(/\/admin\/reservations\/day$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Đặt bàn ngày');
});
