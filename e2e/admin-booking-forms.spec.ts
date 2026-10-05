import type { Page } from '@playwright/test';
import { expectHydrated, watchCsp } from './csp';
import { reservationRow, seedReservation, venueDay } from './reservation-fixtures';
import { STAFF, expect, newVisitor, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * The booking admin on the shared form kit (plan 7B task B9; the phase-4 and
 * phase-5 ledgers' form items): a refused note keeps what was typed, and
 * typed edits survive a status change; the inbox's "Xác nhận" offers "Tải
 * lại" and drops a stale alert; the periods editor names each row's error in
 * its row and asks before the page is left; the inbox keeps five searches,
 * an expired search starts over, and a lapsed session searching goes to
 * sign-in; an email's "Gửi lại" names its recipient and stays off once
 * pressed, and its audit row leads to the booking; a recipient shows its
 * language by name. Bookings at Tàya House +3 (the fixture's default) and
 * yesterday; Phở Cuốn's periods (a Drinks service added and removed through
 * the editor: no other spec reads Phở Cuốn's drinks). Each test puts back
 * what it changed.
 */

test.beforeAll(() => seedStaff());

const main = (page: Page) => page.getByRole('main');

test('a refused note keeps what was typed and a saved one starts over; edits typed before a status change survive it (ADM-1)', async ({ page }) => {
  const r = await seedReservation();
  const violations = await watchCsp(page);
  await signInAs(page, STAFF.editor);
  await page.goto(`/admin/reservations/${r.id}`);
  await expectHydrated(page);

  const notes = page.getByRole('form', { name: 'Thêm ghi chú nội bộ' });
  const body = notes.getByLabel('Thêm ghi chú', { exact: true });
  await body.fill('   ');
  await notes.getByRole('button', { name: 'Lưu ghi chú' }).click();
  await expect(notes.getByText('Nhập nội dung ghi chú.', { exact: true })).toBeVisible();
  await expect(body).toHaveAttribute('aria-invalid', 'true');
  await expect(body).toHaveAccessibleDescription('Nhập nội dung ghi chú.');
  await expect(body).toHaveValue('   ');
  await body.fill('Khách dị ứng tôm');
  await notes.getByRole('button', { name: 'Lưu ghi chú' }).click();
  await expect(main(page).getByRole('list', { name: 'Ghi chú nội bộ' })).toContainText('Khách dị ứng tôm');
  await expect(body).toHaveValue('');
  await expect(body).not.toHaveAttribute('aria-invalid');

  // Typed into the edit form, not saved; then the booking is confirmed above it.
  const edit = page.getByRole('form', { name: 'Sửa đặt bàn' });
  const wish = edit.getByLabel('Yêu cầu của khách', { exact: true });
  await wish.fill('Bàn gần cửa sổ');
  await main(page).getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Đã xác nhận');
  await expect(wish).toHaveValue('Bàn gần cửa sổ');
  await edit.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(edit.getByRole('status')).toHaveText('Đã lưu.');
  expect(await one(`SELECT note, status FROM reservations WHERE id = $1`, [r.id])).toEqual({ note: 'Bàn gần cửa sổ', status: 'confirmed' });
  expect(violations).toEqual([]);
});

test('the inbox’s “Xác nhận” on a booking changed meanwhile says so with “Tải lại”; the alert goes with the refresh, and the confirm then goes through', async ({
  page,
}) => {
  const r = await seedReservation();
  await signInAs(page, STAFF.editor);
  // "Cần xử lý" lists every request, newest first.
  await page.goto('/admin/reservations');
  const row = page.getByRole('row').filter({ hasText: r.reference });
  await expect(row.getByRole('button', { name: `Xác nhận ${r.reference}` })).toBeVisible();
  await expectHydrated(page);

  // A colleague edits it (the version moves; it stays requested).
  await one(`UPDATE reservations SET note = 'Đổi giờ đến', updated_by = $2 WHERE id = $1`, [r.id, STAFF.admin.id]);
  await row.getByRole('button', { name: `Xác nhận ${r.reference}` }).click();
  const alert = row.getByRole('alert');
  await expect(alert).toContainText('Vừa được');
  await alert.getByRole('button', { name: 'Tải lại' }).click();
  await expect(row.getByRole('alert')).toHaveCount(0);
  await row.getByRole('button', { name: `Xác nhận ${r.reference}` }).click();
  // Confirmed, it leaves "Cần xử lý".
  await expect(row).toHaveCount(0);
  expect((await reservationRow(r.id)).status).toBe('confirmed');
});

test('the periods editor: each row’s error in its row, marked invalid; a cleared covers field stays empty; leaving with edits asks first; “Thêm ca” adds a period that saves', async ({
  page,
}) => {
  const seeded = await one<{ periods: unknown }>(
    `SELECT json_agg(json_build_object('meal', meal, 'last', to_char(last_seating, 'HH24:MI'), 'covers', covers_per_slot) ORDER BY meal) AS periods
       FROM service_periods WHERE restaurant_id = 'pho-cuon'`,
  );
  try {
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/restaurants/pho-cuon/booking');
    await expectHydrated(page);
    // The way back to the restaurant's content (7A review UX-10).
    await expect(page.getByRole('navigation', { name: 'Màn của nhà hàng' }).getByRole('link', { name: 'Giờ và sức chứa' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('navigation', { name: 'Màn của nhà hàng' }).getByRole('link', { name: 'Nội dung' })).toHaveAttribute('href', '/admin/restaurants/pho-cuon');

    const editor = page.getByRole('form', { name: 'Ca phục vụ' });
    const lunchLast = editor.getByLabel('Giờ cuối của ca Lunch', { exact: true });
    const dinnerCovers = editor.getByLabel('Sức chứa của ca Dinner', { exact: true });
    const covers = await dinnerCovers.inputValue();
    // Each row's weekdays are a group named for it.
    await expect(editor.getByRole('group', { name: 'Ngày trong tuần của ca Lunch' }).getByRole('checkbox')).toHaveCount(7);

    await lunchLast.fill('13:40');
    await dinnerCovers.fill('');
    await expect(dinnerCovers).toHaveValue('');
    await editor.getByRole('button', { name: 'Lưu ca phục vụ' }).click();
    const grid = 'Giờ cuối phải cách giờ đầu một số lần đúng bằng khoảng cách (ví dụ 18:00 → 21:00 với 30 phút).';
    await expect(lunchLast).toHaveAttribute('aria-invalid', 'true');
    await expect(lunchLast).toHaveAccessibleDescription(grid);
    await expect(editor.getByRole('row').filter({ has: page.getByLabel('Giờ cuối của ca Lunch', { exact: true }) })).toContainText(grid);
    await expect(dinnerCovers).toHaveAttribute('aria-invalid', 'true');
    await expect(dinnerCovers).toHaveAccessibleDescription('Nhập số khách mỗi khung giờ (0: không nhận khách).');
    await expect(dinnerCovers).toHaveValue('');
    await expect(editor.getByLabel('Giờ đầu của ca Lunch', { exact: true })).not.toHaveAttribute('aria-invalid');

    // "Xem" of the slot preview loads the whole page: with unsaved edits the browser asks, and staying keeps them (ADM-3).
    let asked = '';
    page.once('dialog', (dialog) => {
      asked = dialog.type();
      void dialog.dismiss();
    });
    await page.getByRole('button', { name: 'Xem', exact: true }).click();
    await expect.poll(() => asked).toBe('beforeunload');
    await expect(page).toHaveURL(/\/admin\/restaurants\/pho-cuon\/booking$/);
    await expect(lunchLast).toHaveValue('13:40');

    // Put the two back, add a period: Drinks at its own hours, beside breakfast, lunch and dinner, saves as it comes.
    await lunchLast.fill('13:30');
    await dinnerCovers.fill(covers);
    await editor.getByRole('button', { name: 'Thêm ca' }).click();
    await expect(editor.getByLabel('Bữa của ca 4', { exact: true })).toHaveValue('Drinks');
    await expect(editor.getByLabel('Giờ đầu của ca Drinks', { exact: true })).toHaveValue('21:30');
    await editor.getByRole('button', { name: 'Lưu ca phục vụ' }).click();
    await expect(editor.getByRole('status')).toHaveText('Đã lưu ca phục vụ.');
    expect(
      await one(
        `SELECT to_char(first_seating, 'HH24:MI') AS first, to_char(last_seating, 'HH24:MI') AS last, active FROM service_periods WHERE restaurant_id = 'pho-cuon' AND meal = 'Drinks'`,
      ),
    ).toEqual({ first: '21:30', last: '23:30', active: true });

    // And off again, through the editor: the guest's catalogue is expired by the save, not by SQL.
    // The shared token moves with each save (R16): its new value says this second save is through.
    const token = editor.locator('input[name="token"]');
    const before = await token.inputValue();
    await editor.getByRole('button', { name: 'Xóa ca Drinks' }).click();
    await editor.getByRole('button', { name: 'Lưu ca phục vụ' }).click();
    await expect(token).not.toHaveValue(before);
    await expect(editor.getByLabel('Bữa của ca 4', { exact: true })).toHaveCount(0);
    expect(await one(`SELECT count(*)::int AS n FROM service_periods WHERE restaurant_id = 'pho-cuon' AND meal = 'Drinks'`)).toEqual({ n: 0 });
  } finally {
    await one(`DELETE FROM service_periods WHERE restaurant_id = 'pho-cuon' AND meal = 'Drinks'`);
    for (const p of (seeded?.periods ?? []) as { meal: string; last: string; covers: number }[]) {
      await one(`UPDATE service_periods SET last_seating = $2::time, covers_per_slot = $3 WHERE restaurant_id = 'pho-cuon' AND meal = $1`, [p.meal, p.last, p.covers]);
    }
    await one(`DELETE FROM audit_log WHERE entity_type = 'service_periods' AND entity_id = 'pho-cuon'`);
  }
});

test('the inbox keeps five searches: Back to the first still shows it; an expired search starts its tab over; a lapsed session that searches goes to sign-in', async ({
  page,
  browser,
}, testInfo) => {
  const [first, second] = [await seedReservation(), await seedReservation()];
  await signInAs(page, STAFF.editor);
  await page.goto('/admin/reservations');
  const box = page.getByLabel('Tìm theo mã, số điện thoại, tên hoặc email', { exact: true });
  for (const r of [first, second]) {
    await box.fill(r.reference);
    await page.getByRole('button', { name: 'Tìm', exact: true }).click();
    await expect(page.getByText(`Kết quả cho “${r.reference}” trong mọi đặt bàn.`)).toBeVisible();
  }
  // Back to the first search (phase-5 F5): its own results, not "expired".
  await page.goBack();
  await expect(page.getByText(`Kết quả cho “${first.reference}” trong mọi đặt bàn.`)).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: first.reference })).toBeVisible();

  // Page 2 of a search that is gone (T12.5): the tab starts over, with no "← Trang đầu" back into nothing.
  await page.goto('/admin/reservations?tim=ffffffff&sau=x');
  await expect(main(page).getByRole('status')).toHaveText('Kết quả tìm kiếm đã hết hạn. Hãy tìm lại.');
  await expect(page.getByRole('link', { name: '← Trang đầu' })).toHaveCount(0);

  // A session that ended while the inbox stayed open (T12.4): the search goes to sign-in, then back.
  const lapsed = await newVisitor(browser, testInfo);
  await signInAs(lapsed, STAFF.editor);
  await lapsed.goto('/admin/reservations');
  await expectHydrated(lapsed);
  const cookie = (await lapsed.context().cookies()).find((c) => c.name.endsWith('session_token'));
  await one(`DELETE FROM staff_session WHERE token = $1`, [decodeURIComponent(cookie!.value).split('.')[0]]);
  await lapsed.getByLabel('Tìm theo mã, số điện thoại, tên hoặc email', { exact: true }).fill(first.reference);
  await lapsed.getByRole('button', { name: 'Tìm', exact: true }).click();
  await expect(lapsed).toHaveURL(/\/admin\/sign-in\?next=%2Fadmin%2Freservations$/);
  await expect(lapsed.getByRole('heading', { level: 1 })).toHaveText('Đăng nhập');
  await lapsed.context().close();
});

test('“Báo khách” is gone once the sitting has started, and the notice says why no email went (phase-5 residual)', async ({ page }) => {
  // Tàya House yesterday at 19:00: "Hủy" has no time window, but no booking email goes out once the sitting has started.
  const r = await seedReservation({ status: 'confirmed', date: venueDay(-1), time: '19:00' });
  await one(`UPDATE reservations SET email = $2 WHERE id = $1`, [r.id, `late-${r.reference.toLowerCase()}@example.com`]);
  await signInAs(page, STAFF.editor);
  await page.goto(`/admin/reservations/${r.id}`);
  await expectHydrated(page);
  await expect(main(page).getByRole('checkbox', { name: 'Báo khách qua email khi hủy' })).toHaveCount(0);
  await expect(main(page).getByText('Đã qua giờ hẹn: thay đổi ở đây không gửi email cho khách, hãy gọi điện nếu cần báo.')).toBeVisible();
  const reason = page.getByLabel('Lý do (bắt buộc khi hủy hoặc từ chối)', { exact: true });
  await expect(reason).not.toHaveAccessibleDescription(/gửi cho khách/);
  await reason.fill('Khách gọi báo hủy');
  await main(page).getByRole('button', { name: 'Hủy', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Đã hủy');
  await expect(main(page).getByRole('status')).toHaveText('Đã chuyển sang “Đã hủy”. Không gửi email cho khách: đã qua giờ hẹn.');
  expect(await one(`SELECT count(*)::int AS n FROM email_outbox WHERE reservation_id = $1`, [r.id])).toEqual({ n: 0 });
});

test('each “Gửi lại” names its recipient and stays off once pressed; the audit row names the email and its booking, and leads to it', async ({ page }) => {
  const r = await seedReservation({ date: venueDay(5) });
  const to = [`a-${r.reference.toLowerCase()}@furama.test`, `b-${r.reference.toLowerCase()}@furama.test`];
  for (const address of to) {
    await one(
      `INSERT INTO email_outbox (env, event, audience, reservation_id, to_email, locale, status, attempts, last_error)
       VALUES ('development', 'staff.new', 'staff', $1, $2, 'vi', 'failed', 6, '421 4.7.0 Try again later')`,
      [r.id, address],
    );
  }
  await signInAs(page, STAFF.admin);
  await page.goto(`/admin/reservations/${r.id}`);
  await expectHydrated(page);
  const emails = page.getByRole('table', { name: 'Email của đặt bàn' });
  const resend = emails.getByRole('button', { name: `Gửi lại Báo nhân viên: đặt bàn mới tới ${to[0]}`, exact: true });
  await expect(emails.getByRole('button', { name: `Gửi lại Báo nhân viên: đặt bàn mới tới ${to[1]}`, exact: true })).toBeVisible();
  await resend.click();
  await expect(emails.getByRole('status')).toHaveText('Đã đưa vào hàng gửi. Tải lại trang sau vài giây để xem kết quả.');
  await expect(resend).toBeDisabled();

  await page.goto('/admin/audit');
  const row = page.getByRole('row').filter({ hasText: r.reference }).first();
  await expect(row.getByRole('link', { name: `Email · Báo nhân viên: đặt bàn mới · ${r.reference}` })).toHaveAttribute('href', `/admin/reservations/${r.id}`);
  await one(`DELETE FROM audit_log WHERE entity_type = 'email_outbox' AND entity_id IN (SELECT id::text FROM email_outbox WHERE reservation_id = $1)`, [r.id]);
});

test('a recipient shows its language by name, and the events group reads its error (T6.6, T6.9)', async ({ page }) => {
  const email = `vi-${Date.now().toString(36)}@furama.test`;
  try {
    // Switched off: it covers no restaurant, so no other spec's shared-inbox list changes.
    await one(`INSERT INTO notification_recipients (scope, restaurant_id, email, locale, active) VALUES ('restaurant', 'hura-izakaya', $1, 'vi', false)`, [email]);
    await signInAs(page, STAFF.admin);
    await page.goto('/admin/settings/notifications');
    await expectHydrated(page);
    await expect(page.getByRole('region', { name: `${email} · Nhà hàng: Hura Izakaya` })).toContainText('Nhà hàng: Hura Izakaya · Tiếng Việt');

    const add = page.getByRole('form', { name: 'Thêm người nhận' });
    await add.getByLabel('Email người nhận', { exact: true }).fill(`x-${email}`);
    await add.getByLabel('Nhà hàng', { exact: true }).selectOption('hura-izakaya');
    await add.getByRole('checkbox', { name: 'Đặt bàn online mới' }).uncheck();
    await add.getByRole('button', { name: 'Thêm người nhận' }).click();
    const events = add.getByRole('group', { name: 'Loại thông báo' });
    await expect(events).toHaveAccessibleDescription('Chọn ít nhất một loại thông báo.');
    expect(await one(`SELECT count(*)::int AS n FROM notification_recipients WHERE email = $1`, [`x-${email}`])).toEqual({ n: 0 });
  } finally {
    await one(`DELETE FROM notification_recipients WHERE email IN ($1, $2)`, [email, `x-${email}`]);
  }
});
