import type { Page } from '@playwright/test';
import { expectHydrated, watchCsp } from './csp';
import { reservationRow, seedReservation, serviceDayNow, venueDay } from './reservation-fixtures';
import { STAFF, expect, newVisitor, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * Spec §14.1 phase 4, the inbox and the detail screen: confirm, cancel and
 * no-show work, with the time windows and the version conflict of §10.3;
 * the inbox search; an edit re-checked against capacity. The admin CSP stays
 * clean (no inline styles). Tàya House at +3, +4 and yesterday, V-Senses Cafe
 * at +8: dates no other spec books there.
 */

test.beforeAll(() => seedStaff());

const main = (page: Page) => page.getByRole('main');

test('an Editor confirms a request; the timeline names who did it', async ({ page }) => {
  const r = await seedReservation();
  const violations = await watchCsp(page);
  await signInAs(page, STAFF.editor);
  await expect(page.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link', { name: 'Đặt bàn' })).toBeVisible();
  await expect(main(page).getByTestId('pending-count')).toContainText('chờ xác nhận');
  await page.goto(`/admin/reservations/${r.id}`);
  await expectHydrated(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`Đặt bàn ${r.reference}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Chờ xác nhận');

  await main(page).getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(main(page).getByRole('status')).toHaveText('Đã cập nhật trạng thái.');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Đã xác nhận');
  const timeline = page.getByRole('list', { name: 'Dòng thời gian' });
  await expect(timeline.getByRole('listitem').first()).toContainText('Chờ xác nhận → Đã xác nhận');
  await expect(timeline.getByRole('listitem').first()).toContainText(`${STAFF.editor.name} (${STAFF.editor.email})`);
  expect(await reservationRow(r.id)).toMatchObject({ status: 'confirmed', version: 2 });
  expect(violations).toEqual([]);
});

test('cancel needs a reason; the reason is kept and shown', async ({ page }) => {
  const r = await seedReservation({ status: 'confirmed' });
  await signInAs(page, STAFF.editor);
  await page.goto(`/admin/reservations/${r.id}`);
  await main(page).getByRole('button', { name: 'Hủy', exact: true }).click();
  await expect(main(page).getByText('Nhập lý do.')).toBeVisible();
  expect((await reservationRow(r.id)).status).toBe('confirmed');

  await page.getByLabel('Lý do (bắt buộc khi hủy hoặc từ chối)', { exact: true }).fill('Khách gọi báo hủy');
  await main(page).getByRole('button', { name: 'Hủy', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Đã hủy');
  await expect(page.getByRole('list', { name: 'Dòng thời gian' }).getByRole('listitem').first()).toContainText('Lý do: Khách gọi báo hủy');
  await expect(main(page).getByText('Đặt bàn đã kết thúc; không còn thao tác nào.')).toBeVisible();
  expect(await reservationRow(r.id)).toMatchObject({ status: 'cancelled', status_reason: 'Khách gọi báo hủy' });
});

test('no-show only once the sitting is 15 minutes past; the correction only on the same service day', async ({ page }) => {
  const future = await seedReservation({ status: 'confirmed', date: venueDay(3) });
  const past = await seedReservation({ status: 'confirmed', date: venueDay(-1), time: '19:00' });
  await signInAs(page, STAFF.editor);

  await page.goto(`/admin/reservations/${future.id}`);
  await expect(main(page).getByRole('button', { name: 'Không đến', exact: true })).toBeDisabled();
  await expect(main(page).getByRole('button', { name: 'Đã đến', exact: true })).toBeDisabled();
  await expect(main(page).getByText(/^Từ 19:15 ngày /)).toBeVisible();
  await expect(main(page).getByText(/^Từ 18:00 ngày /)).toBeVisible();

  await page.goto(`/admin/reservations/${past.id}`);
  await main(page).getByRole('button', { name: 'Không đến', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Không đến');
  expect((await reservationRow(past.id)).status).toBe('no_show');
  // Yesterday's sitting is correctable only while yesterday's service day lasts (until 04:00).
  const correction = main(page).getByRole('button', { name: 'Sửa: khách đã đến', exact: true });
  if (serviceDayNow() === venueDay(-1)) await expect(correction).toBeEnabled();
  else {
    await expect(correction).toBeDisabled();
    await expect(main(page).getByText('Chỉ sửa được trong ngày phục vụ.')).toBeVisible();
  }
});

test('two people at once: the second sees who changed it first, and nothing is overwritten', async ({ page, browser }, testInfo) => {
  const r = await seedReservation();
  const other = await newVisitor(browser, testInfo);
  await signInAs(page, STAFF.editor);
  await signInAs(other, STAFF.admin);
  await page.goto(`/admin/reservations/${r.id}`);
  await other.goto(`/admin/reservations/${r.id}`);

  await other.getByRole('main').getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(other.getByRole('heading', { level: 1 })).toContainText('Đã xác nhận');

  await page.getByLabel('Lý do (bắt buộc khi hủy hoặc từ chối)', { exact: true }).fill('Trùng lịch');
  await main(page).getByRole('button', { name: 'Từ chối', exact: true }).click();
  const alert = main(page).getByRole('alert');
  await expect(alert).toContainText(`Vừa được ${STAFF.admin.name} (${STAFF.admin.email}) thay đổi lúc`);
  expect((await reservationRow(r.id)).status).toBe('confirmed');
  await alert.getByRole('button', { name: 'Tải lại' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Đã xác nhận');
  await other.context().close();
});

test('the inbox finds a booking by reference or phone, and confirms it from the list', async ({ page }) => {
  const r = await seedReservation({ restaurant: 'v-senses-cafe', date: venueDay(8) });
  await signInAs(page, STAFF.editor);
  await page.goto('/admin/reservations');
  await page.getByLabel('Tìm theo mã, số điện thoại, tên hoặc email', { exact: true }).fill(r.reference.toLowerCase().replace('-', ''));
  await page.getByRole('button', { name: 'Tìm', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: r.reference })).toBeVisible();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);

  const local = `0${r.phone.slice(3, 6)} ${r.phone.slice(6, 9)} ${r.phone.slice(9)}`;
  await page.goto(`/admin/reservations?q=${encodeURIComponent(local)}`);
  await expect(page.getByRole('row').filter({ hasText: r.reference })).toBeVisible();

  // A requested booking can be confirmed right from the results.
  await page.getByRole('button', { name: `Xác nhận ${r.reference}` }).click();
  await expect(page.getByRole('row').filter({ hasText: r.reference })).toContainText('Đã xác nhận');
  expect((await reservationRow(r.id)).status).toBe('confirmed');
});

test('an edit into a full slot is refused with the covers left, keeps what was typed, then saves with a reason', async ({ page }) => {
  const date = venueDay(4);
  await seedReservation({ date, time: '19:30', guests: 15, status: 'confirmed' });
  const r = await seedReservation({ date, time: '19:00', guests: 2 });
  await signInAs(page, STAFF.editor);
  await page.goto(`/admin/reservations/${r.id}`);
  await expectHydrated(page);
  const form = page.getByRole('form', { name: 'Sửa đặt bàn' });
  await form.getByLabel('Giờ', { exact: true }).selectOption('19:30');
  await form.getByLabel('Yêu cầu của khách', { exact: true }).fill('Ghế em bé');
  await form.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(form.getByRole('alert')).toHaveText('Khung giờ này chỉ còn 1 chỗ. Muốn vẫn nhận, hãy ghi lý do vượt sức chứa.');
  await expect(form.getByLabel('Giờ', { exact: true })).toHaveValue('19:30');
  await expect(form.getByLabel('Yêu cầu của khách', { exact: true })).toHaveValue('Ghế em bé');
  expect(await reservationRow(r.id)).toMatchObject({ reserved_at: '19:00', version: 1 });

  await form.getByLabel('Lý do vượt sức chứa (chỉ khi khung giờ đã hết chỗ)', { exact: true }).fill('Khách quen, kê thêm ghế');
  await form.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(form.getByRole('status')).toHaveText('Đã lưu.');
  await expect(page.getByTestId('sitting')).toContainText('19:30');
  const latest = page.getByRole('list', { name: 'Dòng thời gian' }).getByRole('listitem').first();
  await expect(latest).toContainText('Giờ: 19:00 → 19:30');
  await expect(latest).toContainText('Lý do: Khách quen, kê thêm ghế');
  expect(await reservationRow(r.id)).toMatchObject({ reserved_at: '19:30', over_capacity: true, version: 2 });
});
