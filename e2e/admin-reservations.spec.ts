import type { Page, Route } from '@playwright/test';
import { formatIsoDayVi } from '../lib/admin/format';
import { HOLDING_STATUSES } from '../lib/booking/rules';
import { expectHydrated, watchCsp } from './csp';
import { reservationRow, seedReservation, serviceDayNow, venueDay } from './reservation-fixtures';
import { STAFF, expect, newVisitor, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * Spec §14.1 phase 4, the inbox and the detail screen: confirm, cancel and
 * no-show work, with the time windows and the version conflict of §10.3;
 * the inbox search; an edit re-checked against capacity; a phone booking
 * past capacity; a phone booking at the restaurant and date the picker
 * shows; the printable day sheet. The admin CSP stays clean (no inline
 * styles). Tàya House at +3, +4, +6 (one booking outside the hours) and
 * yesterday, V-Senses Cafe at +8, ChaoShan Hotpot at +7, Café Indochine at
 * +6: dates no other spec books there. The tests that count covers (Tàya
 * House +4 and +6, ChaoShan Hotpot +7) empty their day first, so the file
 * passes again on a database it has already run on.
 */

test.beforeAll(() => seedStaff());

const main = (page: Page) => page.getByRole('main');

/**
 * A test that counts covers first empties the restaurant-day it owns: a second run on the same database
 * would otherwise count the first run's bookings as well. Their events and notes go with them (ON DELETE CASCADE).
 */
const clearDay = (restaurant: string, date: string) =>
  one(`DELETE FROM reservations WHERE restaurant_id = $1 AND reserved_on = $2::date`, [restaurant, date]);

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
  await clearDay('taya-house', date);
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

test('a phone booking past capacity needs a reason; the form keeps what was typed, then opens the new booking', async ({ page }) => {
  // ChaoShan Hotpot dinner, seven days out: 28 covers a slot, and no other spec books it.
  const date = venueDay(7);
  await clearDay('chaoshan-hotpot', date);
  const violations = await watchCsp(page);
  await signInAs(page, STAFF.editor);
  await page.goto(`/admin/reservations/new?nha_hang=chaoshan-hotpot&ngay=${date}`);
  await expectHydrated(page);
  const form = page.getByRole('form', { name: 'Đặt bàn mới' });
  await expect(form.getByRole('radio', { name: 'Khách vãng lai (đã đến)' })).toBeDisabled();
  await form.getByLabel('Giờ', { exact: true }).selectOption('19:00');
  await form.getByLabel('Số khách', { exact: true }).fill('30');
  await form.getByLabel('Tên khách', { exact: true }).fill('Đoàn khách E2E');
  const digits = String(Date.now()).slice(-6);
  await form.getByLabel('Điện thoại', { exact: true }).fill(`0912 ${digits.slice(0, 3)} ${digits.slice(3)}`);
  await form.getByLabel('Ngôn ngữ của khách', { exact: true }).selectOption('vi');
  await form.getByRole('button', { name: 'Tạo đặt bàn' }).click();
  await expect(form.getByRole('alert')).toContainText('Khung giờ này chỉ còn');
  // Refused, not reset: what was typed is still there.
  await expect(form.getByLabel('Tên khách', { exact: true })).toHaveValue('Đoàn khách E2E');
  await expect(form.getByLabel('Số khách', { exact: true })).toHaveValue('30');

  await form.getByLabel('Lý do vượt sức chứa (chỉ khi khung giờ đã hết chỗ)', { exact: true }).fill('Đoàn công ty, đã gọi bếp');
  await form.getByRole('button', { name: 'Tạo đặt bàn' }).click();
  // redirect() inside the action's try: actionError lets it through (unstable_rethrow).
  await expect(page).toHaveURL(/\/admin\/reservations\/\d+$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Đã xác nhận');
  await expect(page.getByTestId('sitting')).toContainText('19:00 · Dinner');
  const created = page.getByRole('list', { name: 'Dòng thời gian' }).getByRole('listitem').first();
  await expect(created).toContainText('Tạo đặt bàn');
  await expect(created).toContainText('Lý do: Đoàn công ty, đã gọi bếp');
  const id = new URL(page.url()).pathname.split('/').pop();
  expect(await one(`SELECT source, status, over_capacity, locale, guests FROM reservations WHERE id = $1`, [id])).toEqual({
    source: 'phone',
    status: 'confirmed',
    over_capacity: true,
    locale: 'vi',
    guests: 30,
  });
  expect(violations).toEqual([]);
});

test('the booking goes where the picker points, without "Xem giờ trống"; while it loads, the form refuses', async ({ page }) => {
  // Opened on The Fan at +5 (nothing is written there); booked at Café Indochine at +6, which no other spec books.
  const from = venueDay(5);
  const date = venueDay(6);
  const violations = await watchCsp(page);
  await signInAs(page, STAFF.editor);
  await page.goto(`/admin/reservations/new?nha_hang=the-fan&ngay=${from}`);
  await expectHydrated(page);
  const picker = page.getByRole('form', { name: 'Chọn nhà hàng và ngày' });
  const form = page.getByRole('form', { name: 'Đặt bàn mới' });
  const target = form.getByText(/^Đặt tại:/);
  await expect(target).toHaveText(`Đặt tại: Steakhouse The Fan · ${formatIsoDayVi(from)}`);

  // Hold the picker's navigations (RSC requests): while one is in flight the form still shows the old target's times.
  const held: Route[] = [];
  await page.route('**/admin/reservations/new?*', (route) => (route.request().headers()['rsc'] ? held.push(route) : route.continue()));
  let posts = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.headers()['next-action']) posts += 1;
  });
  await picker.getByLabel('Nhà hàng', { exact: true }).selectOption('cafe-indochine');
  await picker.getByLabel('Ngày', { exact: true }).fill(date);
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await form.getByRole('button', { name: 'Tạo đặt bàn' }).click();
  await expect(form.getByRole('alert')).toHaveText('Đang tải giờ trống của nhà hàng và ngày vừa chọn; bấm lại khi danh sách giờ hiện ra.');
  expect(posts).toBe(0);

  await page.unroute('**/admin/reservations/new?*');
  for (const route of held) await route.continue().catch(() => {}); // a superseded navigation may be gone already
  await expect(target).toHaveText(`Đặt tại: Café Indochine · ${formatIsoDayVi(date)}`);
  await form.getByLabel('Giờ', { exact: true }).selectOption('19:00');
  await form.getByLabel('Tên khách', { exact: true }).fill('Khách Café Indochine E2E');
  const digits = String(Date.now()).slice(-6);
  await form.getByLabel('Điện thoại', { exact: true }).fill(`0913 ${digits.slice(0, 3)} ${digits.slice(3)}`);
  await form.getByRole('button', { name: 'Tạo đặt bàn' }).click();
  await expect(page).toHaveURL(/\/admin\/reservations\/\d+$/);
  const id = new URL(page.url()).pathname.split('/').pop();
  expect(await one(`SELECT restaurant_id, to_char(reserved_on, 'YYYY-MM-DD') AS reserved_on FROM reservations WHERE id = $1`, [id])).toEqual({
    restaurant_id: 'cafe-indochine',
    reserved_on: date,
  });
  expect(violations).toEqual([]);
});

test('the day sheet lists each service with its load, and prints without the admin chrome', async ({ page }) => {
  const date = venueDay(6);
  await clearDay('taya-house', date);
  const r = await seedReservation({ date, status: 'confirmed', guests: 4 });
  // Dinner ends at 21:00: a booking at 23:30 (made before the hours changed) still holds its covers.
  const late = await seedReservation({ date, time: '23:30', meal: 'Dinner', status: 'confirmed', guests: 3, name: 'Khách Ngoài Giờ E2E' });
  const violations = await watchCsp(page);
  await signInAs(page, STAFF.editor);
  await page.goto(`/admin/reservations/day?ngay=${date}&nha_hang=taya-house`);
  const sheet = page.getByRole('region', { name: 'Tàya House' });
  const row = sheet.getByRole('row').filter({ hasText: r.reference });
  await expect(row).toContainText('19:00');
  await expect(row).toContainText('4/16');
  // The host can greet and call the outside-hours guest, and the restaurant's total counts them.
  await expect(sheet.getByRole('heading', { name: 'Ngoài giờ phục vụ hiện tại', level: 3 })).toBeVisible();
  const outside = sheet.getByRole('row').filter({ hasText: late.reference });
  await expect(outside).toContainText('23:30');
  await expect(outside).toContainText(`Khách Ngoài Giờ E2E · ${late.phone}`);
  await expect(outside).toContainText('Đã xác nhận');
  const held = await one<{ n: number }>(
    `SELECT coalesce(sum(guests), 0)::int AS n FROM reservations WHERE restaurant_id = 'taya-house' AND reserved_on = $1::date AND status = ANY ($2::text[])`,
    [date, HOLDING_STATUSES],
  );
  await expect(sheet.getByRole('heading', { level: 2 })).toHaveText(`Tàya House · ${held!.n} khách`);
  await expect(page.getByRole('button', { name: 'In bảng' })).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('navigation', { name: 'Điều hướng quản trị' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'In bảng' })).toBeHidden();
  await expect(row).toBeVisible();
  await expect(outside).toBeVisible();
  expect(violations).toEqual([]);
});
