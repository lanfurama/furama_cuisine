import type { Page, Route } from '@playwright/test';
import { formatIsoDayVi } from '../lib/admin/format';
import { HOLDING_STATUSES } from '../lib/booking/rules';
import { expectHydrated, watchCsp } from './csp';
import { emailsTo } from './email-log';
import { reservationRow, seedReservation, serviceDayNow, venueDay } from './reservation-fixtures';
import { STAFF, expect, newVisitor, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * Spec §14.1 phase 4, the inbox and the detail screen: confirm, cancel and
 * no-show work, with the time windows and the version conflict of §10.3;
 * the inbox search; an edit re-checked against capacity; a phone booking
 * past capacity; a phone booking at the restaurant and date the picker
 * shows; the printable day sheet; the guest-email checkboxes of phase 5; Enter
 * in the reason field changing nothing; no email promised after the sitting.
 * The admin CSP stays clean (no inline styles). Tàya House at +3, +4, +6 (one
 * booking outside the hours) and yesterday (the no-show, the confirmed booking
 * the Enter test leaves as it is, and one cancelled after its sitting),
 * V-Senses Cafe at +8, ChaoShan Hotpot at +7, Café Indochine at +6: dates no
 * other spec books there. The tests that count covers (Tàya
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

/**
 * Counts the page's form submissions from now on. Implicit submission (Enter in a text field) fires its
 * submit event while the key is handled, so the count is settled once press() returns: an exact test
 * that nothing was submitted, where waiting for "no request" could only time out.
 */
async function countSubmits(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const w = window as unknown as { submits: number };
    w.submits = 0;
    document.addEventListener('submit', () => (w.submits += 1), true);
  });
  return () => page.evaluate(() => (window as unknown as { submits: number }).submits);
}

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
  // The notice names the change; this guest gave no email, so it promises none.
  await expect(main(page).getByRole('status')).toHaveText('Đã chuyển sang “Đã xác nhận”.');
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
  // No guest email, so no email will quote the reason (R8), and no "Báo khách" box pretends one will go:
  // the panel says to phone instead (F2).
  await expect(main(page).getByText(/sẽ được gửi cho khách/)).toHaveCount(0);
  await expect(main(page).getByText('Khách không để lại email: thay đổi ở đây không gửi email nào, hãy gọi điện báo khách.')).toBeVisible();
  await expect(main(page).getByRole('checkbox', { name: 'Báo khách qua email khi hủy' })).toHaveCount(0);
  await main(page).getByRole('button', { name: 'Hủy', exact: true }).click();
  await expect(main(page).getByText('Nhập lý do.')).toBeVisible();
  expect((await reservationRow(r.id)).status).toBe('confirmed');

  await page.getByLabel('Lý do (bắt buộc khi hủy hoặc từ chối)', { exact: true }).fill('Khách gọi báo hủy');
  await main(page).getByRole('button', { name: 'Hủy', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Đã hủy');
  await expect(main(page).getByRole('status')).toHaveText('Đã chuyển sang “Đã hủy”.');
  await expect(page.getByRole('list', { name: 'Dòng thời gian' }).getByRole('listitem').first()).toContainText('Lý do: Khách gọi báo hủy');
  await expect(main(page).getByText('Đặt bàn đã kết thúc; không còn thao tác nào.')).toBeVisible();
  expect(await reservationRow(r.id)).toMatchObject({ status: 'cancelled', status_reason: 'Khách gọi báo hủy' });
});

test('the guest emails staff choose (R8): "Báo khách" is on for a cancel and says the reason goes out; unticked, it stays so through a refused cancel; "Gửi email xác nhận" is for a phone booking only, and stays unticked across the walk-in radio', async ({ page }) => {
  const r = await seedReservation({ status: 'confirmed' });
  const guest = `cancel-${r.id}@example.com`;
  await one(`UPDATE reservations SET email = $2 WHERE id = $1`, [r.id, guest]);
  await signInAs(page, STAFF.editor);
  await page.goto(`/admin/reservations/${r.id}`);
  await expectHydrated(page);
  const notify = main(page).getByRole('checkbox', { name: 'Báo khách qua email khi hủy' });
  const reason = page.getByLabel('Lý do (bắt buộc khi hủy hoặc từ chối)', { exact: true });
  const cancel = main(page).getByRole('button', { name: 'Hủy', exact: true });
  // One reason field serves every button: the hint names the ones whose email quotes it ("Đã đến" emails no one).
  const hint = main(page).getByText(/sẽ được gửi cho khách/);
  await expect(notify).toBeChecked();
  await expect(hint).toHaveText('Khi hủy, lý do này sẽ được gửi cho khách.');
  await notify.uncheck();
  await expect(hint).toHaveCount(0);
  await notify.check();
  await reason.fill('Nhà hàng có tiệc riêng');
  await cancel.click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Đã hủy');
  await expect(main(page).getByRole('status')).toHaveText('Đã chuyển sang “Đã hủy”. Email báo khách đang được gửi.');
  expect(await one(`SELECT event, to_email FROM email_outbox WHERE reservation_id = $1`, [r.id])).toEqual({ event: 'guest.cancelled', to_email: guest });

  // Unticked, the box stays unticked through each refusal (no reason; someone else's change, then "Tải lại"),
  // and so does the reason once typed: the cancel that finally goes through emails no one.
  const quiet = await seedReservation();
  await one(`UPDATE reservations SET email = $2 WHERE id = $1`, [quiet.id, `quiet-${quiet.id}@example.com`]);
  await page.goto(`/admin/reservations/${quiet.id}`);
  await expectHydrated(page);
  await expect(hint).toHaveText('Khi từ chối hoặc hủy, lý do này sẽ được gửi cho khách.');
  await notify.uncheck();
  await expect(hint).toHaveText('Khi từ chối, lý do này sẽ được gửi cho khách.');
  await cancel.click();
  await expect(main(page).getByText('Nhập lý do.')).toBeVisible();
  await expect(notify).not.toBeChecked();
  await expect(hint).toHaveText('Khi từ chối, lý do này sẽ được gửi cho khách.');
  await reason.fill('Khách đổi ngày');
  await one(`UPDATE reservations SET note = 'Ghế trẻ em' WHERE id = $1`, [quiet.id]);
  await cancel.click();
  const alert = main(page).getByRole('alert');
  await expect(alert).toContainText('Vừa được người khác thay đổi');
  await expect(notify).not.toBeChecked();
  await expect(reason).toHaveValue('Khách đổi ngày');
  await alert.getByRole('button', { name: 'Tải lại' }).click();
  // The reload drew the change (the edit form shows it) and kept the box and the reason.
  await expect(page.getByRole('form', { name: 'Sửa đặt bàn' }).getByLabel('Yêu cầu của khách', { exact: true })).toHaveValue('Ghế trẻ em');
  await expect(notify).not.toBeChecked();
  await expect(reason).toHaveValue('Khách đổi ngày');
  await cancel.click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Đã hủy');
  // Unticked: the notice promises no email.
  await expect(main(page).getByRole('status')).toHaveText('Đã chuyển sang “Đã hủy”.');
  expect(await reservationRow(quiet.id)).toMatchObject({ status: 'cancelled', status_reason: 'Khách đổi ngày' });
  expect(await one(`SELECT count(*)::int AS n FROM email_outbox WHERE reservation_id = $1`, [quiet.id])).toEqual({ n: 0 });

  // Nothing is booked below: the form only shows or hides the box.
  await page.goto('/admin/reservations/new?nha_hang=taya-house');
  await expectHydrated(page);
  const form = page.getByRole('form', { name: 'Đặt bàn mới' });
  const confirmEmail = form.getByRole('checkbox', { name: 'Gửi email xác nhận cho khách (khi có email)' });
  await expect(confirmEmail).toBeChecked();
  // The guest asked for no email: unticked, a slip onto "Khách vãng lai" and back must not tick it again (F3).
  await confirmEmail.uncheck();
  await form.getByRole('radio', { name: 'Khách vãng lai (đã đến)' }).check();
  await expect(confirmEmail).toBeHidden();
  await form.getByRole('radio', { name: 'Điện thoại (đã xác nhận)' }).check();
  await expect(confirmEmail).toBeVisible();
  await expect(confirmEmail).not.toBeChecked();
});

test('Enter in “Lý do” on a request submits nothing: it stays requested, with no event and no email (F1)', async ({ page }) => {
  const r = await seedReservation();
  await one(`UPDATE reservations SET email = $2 WHERE id = $1`, [r.id, `enter-${r.reference.toLowerCase()}@example.com`]);
  const { version } = await reservationRow(r.id);
  await signInAs(page, STAFF.editor);
  await page.goto(`/admin/reservations/${r.id}`);
  await expectHydrated(page);
  let posts = 0;
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.headers()['next-action']) posts += 1;
  });
  const submits = await countSubmits(page);
  // "Xác nhận" is the panel's first button: an implicit submission would confirm the booking.
  const reason = page.getByLabel('Lý do (bắt buộc khi hủy hoặc từ chối)', { exact: true });
  await reason.fill('Khách hỏi lại giờ');
  await reason.press('Enter');
  expect(await submits(), 'Enter in “Lý do” submitted the status form').toBe(0);
  expect(await reservationRow(r.id)).toMatchObject({ status: 'requested', version });
  expect(await one(`SELECT count(*)::int AS n FROM reservation_events WHERE reservation_id = $1`, [r.id])).toEqual({ n: 0 });
  expect(await one(`SELECT count(*)::int AS n FROM email_outbox WHERE reservation_id = $1`, [r.id])).toEqual({ n: 0 });
  await expect(main(page).getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Chờ xác nhận');
  await expect(reason).toHaveValue('Khách hỏi lại giờ');
  expect(posts).toBe(0);
});

test('Enter in “Lý do” on a confirmed booking, “Báo khách” ticked, cancels nothing and emails no one (F1)', async ({ page }) => {
  // Tàya House yesterday at 19:00, like the no-show test: past its sitting, so every button of a confirmed
  // booking is enabled, and the first one is "Hủy", which would cancel it and email the guest this note.
  const r = await seedReservation({ status: 'confirmed', date: venueDay(-1), time: '19:00' });
  const guest = `enter-${r.reference.toLowerCase()}@example.com`;
  await one(`UPDATE reservations SET email = $2 WHERE id = $1`, [r.id, guest]);
  const { version } = await reservationRow(r.id);
  await signInAs(page, STAFF.editor);
  await page.goto(`/admin/reservations/${r.id}`);
  await expectHydrated(page);
  await expect(main(page).getByRole('button', { name: 'Không đến', exact: true })).toBeEnabled();
  await expect(main(page).getByRole('checkbox', { name: 'Báo khách qua email khi hủy' })).toBeChecked();
  const submits = await countSubmits(page);
  const reason = page.getByLabel('Lý do (bắt buộc khi hủy hoặc từ chối)', { exact: true });
  await reason.fill('Nội bộ: khách còn nợ tiền cọc');
  await reason.press('Enter');
  expect(await submits(), 'Enter in “Lý do” submitted the status form').toBe(0);
  expect(await reservationRow(r.id)).toMatchObject({ status: 'confirmed', version });
  expect(await one(`SELECT count(*)::int AS n FROM email_outbox WHERE reservation_id = $1`, [r.id])).toEqual({ n: 0 });
  expect(emailsTo(guest)).toEqual([]);
  await expect(main(page).getByRole('status')).toHaveCount(0);
});

test('a cancel after the sitting has started, “Báo khách” ticked: the notice promises no email, since the sender skips it (F5)', async ({ page }) => {
  // Tàya House yesterday at 19:00: "Hủy" has no time window, but no booking email goes out once the sitting has started.
  const r = await seedReservation({ status: 'confirmed', date: venueDay(-1), time: '19:00' });
  const guest = `late-${r.reference.toLowerCase()}@example.com`;
  await one(`UPDATE reservations SET email = $2 WHERE id = $1`, [r.id, guest]);
  await signInAs(page, STAFF.editor);
  await page.goto(`/admin/reservations/${r.id}`);
  await expectHydrated(page);
  await expect(main(page).getByRole('checkbox', { name: 'Báo khách qua email khi hủy' })).toBeChecked();
  await page.getByLabel('Lý do (bắt buộc khi hủy hoặc từ chối)', { exact: true }).fill('Khách gọi báo hủy');
  await main(page).getByRole('button', { name: 'Hủy', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Đã hủy');
  await expect(main(page).getByRole('status')).toHaveText('Đã chuyển sang “Đã hủy”.');
  // What the notice left out is what happens: the row is skipped by this action's own drain, never sent.
  await expect
    .poll(() => one(`SELECT status, last_error FROM email_outbox WHERE reservation_id = $1`, [r.id]))
    .toEqual({ status: 'skipped', last_error: 'skipped: the sitting has passed' });
  expect(emailsTo(guest)).toEqual([]);
});

test('a change names itself, then the panel starts over: the reason empty, “Báo khách” ticked again (F1)', async ({ page }) => {
  const r = await seedReservation();
  await one(`UPDATE reservations SET email = $2 WHERE id = $1`, [r.id, `reset-${r.reference.toLowerCase()}@example.com`]);
  await signInAs(page, STAFF.editor);
  await page.goto(`/admin/reservations/${r.id}`);
  await expectHydrated(page);
  const notify = main(page).getByRole('checkbox', { name: 'Báo khách qua email khi hủy' });
  const reason = page.getByLabel('Lý do (bắt buộc khi hủy hoặc từ chối)', { exact: true });
  await reason.fill('Đã gọi xác nhận với khách');
  await notify.uncheck();
  await main(page).getByRole('button', { name: 'Xác nhận', exact: true }).click();
  // Confirming always emails a guest who gave an address, whatever "Báo khách" (it is for a cancel).
  await expect(main(page).getByRole('status')).toHaveText('Đã chuyển sang “Đã xác nhận”. Email báo khách đang được gửi.');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Đã xác nhận');
  // Still cancel-capable: the next cancel starts from an empty reason and a ticked box.
  await expect(reason).toHaveValue('');
  await expect(notify).toBeChecked();
  expect(await one(`SELECT event FROM email_outbox WHERE reservation_id = $1`, [r.id])).toEqual({ event: 'guest.confirmed' });
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
  const box = page.getByLabel('Tìm theo mã, số điện thoại, tên hoặc email', { exact: true });
  await box.fill(r.reference.toLowerCase().replace('-', ''));
  await page.getByRole('button', { name: 'Tìm', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: r.reference })).toBeVisible();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);

  // Phase-4 ruling SEC-2: the guest's number never reaches the URL (request logs, history, the sign-in `next`).
  const local = `0${r.phone.slice(3, 6)} ${r.phone.slice(6, 9)} ${r.phone.slice(9)}`;
  const first = page.url();
  await box.fill(local);
  await page.getByRole('button', { name: 'Tìm', exact: true }).click();
  // The lede first: the URL check below must see the second search's page, not the first one's.
  await expect(page.getByText(`Kết quả cho “${local}” trong mọi đặt bàn.`)).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: r.reference })).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/reservations\?tim=[0-9a-f]{8}$/);
  expect(page.url()).not.toBe(first);
  expect(page.url()).not.toContain(r.phone.slice(-6));
  // R18 rests on the cookie that holds the text: httpOnly, Strict, the inbox's path only, 30 minutes,
  // and `secure` everywhere but a plain-http origin like this server's.
  const cookie = (await page.context().cookies()).find((c) => c.name === 'fc_inbox_search');
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/admin/reservations', secure: false });
  expect(Math.abs(cookie!.expires - (Date.now() / 1000 + 30 * 60))).toBeLessThanOrEqual(60);
  // A reload keeps the results: the text waits in an httpOnly cookie under that id.
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: r.reference })).toBeVisible();
  await expect(box).toHaveValue(local);
  expect(await page.evaluate(() => document.cookie)).not.toContain('fc_inbox_search');

  // A requested booking can be confirmed right from the results.
  await page.getByRole('button', { name: `Xác nhận ${r.reference}` }).click();
  await expect(page.getByRole('row').filter({ hasText: r.reference })).toContainText('Đã xác nhận');
  expect((await reservationRow(r.id)).status).toBe('confirmed');

  // A search in another tab replaces the cookie: this tab says so rather than showing the other tab's results.
  const other = await page.context().newPage();
  await other.goto('/admin/reservations');
  await other.getByLabel('Tìm theo mã, số điện thoại, tên hoặc email', { exact: true }).fill('Không ai tên này');
  await other.getByRole('button', { name: 'Tìm', exact: true }).click();
  await expect(other.getByText('Kết quả cho “Không ai tên này” trong mọi đặt bàn.')).toBeVisible();
  await page.reload();
  await expect(main(page).getByRole('status')).toHaveText('Kết quả tìm kiếm đã hết hạn. Hãy tìm lại.');
  await expect(page.getByRole('navigation', { name: 'Lọc đặt bàn' })).toBeVisible();
  await other.close();
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
  // With an email and "Gửi email xác nhận" left ticked, the guest is told (spec §10.3, R8).
  const guest = `created-${Date.now().toString(36)}@example.com`;
  await form.getByLabel('Email (không bắt buộc)', { exact: true }).fill(guest);
  await form.getByLabel('Ngôn ngữ của khách', { exact: true }).selectOption('en');
  await expect(form.getByRole('checkbox', { name: 'Gửi email xác nhận cho khách (khi có email)' })).toBeChecked();
  await form.getByRole('button', { name: 'Tạo đặt bàn' }).click();
  await expect(page).toHaveURL(/\/admin\/reservations\/\d+$/);
  const id = new URL(page.url()).pathname.split('/').pop();
  const created = await one<{ restaurant_id: string; reserved_on: string; reference: string }>(
    `SELECT restaurant_id, to_char(reserved_on, 'YYYY-MM-DD') AS reserved_on, reference FROM reservations WHERE id = $1`,
    [id],
  );
  expect(created).toMatchObject({ restaurant_id: 'cafe-indochine', reserved_on: date });
  // No cron runs here: only the action's own after() (drainAfterCommit before redirect()) can send it (T4.4).
  await expect.poll(() => emailsTo(guest).map((e) => e.subject)).toEqual([`Your table is confirmed (${created!.reference})`]);
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
