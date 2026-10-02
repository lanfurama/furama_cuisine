import type { Page } from '@playwright/test';
import { formatDay } from '../lib/venue-time';
import { expectHydrated, watchCsp } from './csp';
import { emailsTo } from './email-log';
import { HOME_PATH } from './paths';
import { reservationRow, seedReservation, venueDay } from './reservation-fixtures';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * Closures (spec §10.1, §14.1 phase 4): a closure made in the admin lists the
 * bookings it takes out and cancels only what staff tick, skipping one that
 * changed since the page was drawn, and emails the guests only while "Báo
 * khách qua email" is ticked, naming those it could not email, with their
 * number to call; the guest sees the day greyed out with the
 * public reason. Phố Cuốn at +5 and the MM Supercenter (Yum Food Village,
 * ChaoShan Hotpot) at +11: dates no other spec books there; Phố Cuốn at
 * +60 to +62, past every booking window. Each test deletes its closure.
 */

test.beforeAll(() => seedStaff());
test.use({ reducedMotion: 'reduce' });

/** Fills the "Thêm ngày đóng cửa" form; the internal note names the closure's card afterwards. */
async function addClosure(
  page: Page,
  c: { scope: 'restaurant' | 'destination'; target: string; from: string; to: string; meals?: string[]; reasonEn?: string; note: string },
) {
  const add = page.getByRole('form', { name: 'Thêm ngày đóng cửa' });
  await add.getByLabel('Phạm vi', { exact: true }).selectOption(c.scope);
  await add.getByLabel(c.scope === 'restaurant' ? 'Nhà hàng' : 'Điểm đến', { exact: true }).selectOption(c.target);
  await add.getByLabel('Từ ngày', { exact: true }).fill(c.from);
  await add.getByLabel('Đến ngày', { exact: true }).fill(c.to);
  for (const meal of c.meals ?? []) await add.getByRole('checkbox', { name: meal, exact: true }).check();
  if (c.reasonEn) await add.getByLabel('Lý do cho khách (EN)', { exact: true }).fill(c.reasonEn);
  await add.getByLabel('Ghi chú nội bộ (khách không thấy)', { exact: true }).fill(c.note);
  await add.getByRole('button', { name: 'Thêm ngày đóng cửa' }).click();
  await expect(add.getByRole('status')).toHaveText('Đã thêm ngày đóng cửa.');
  return page.getByRole('region').filter({ hasText: c.note });
}

test('a dinner closure lists the dinner bookings, not lunch, and cancels only the ticked one that has not changed', async ({ page }) => {
  // Phố Cuốn, five days out.
  const date = venueDay(5);
  const dinner = await seedReservation({ restaurant: 'pho-cuon', date, time: '19:00' });
  const changed = await seedReservation({ restaurant: 'pho-cuon', date, time: '19:30', status: 'confirmed' });
  const lunch = await seedReservation({ restaurant: 'pho-cuon', date, time: '12:00', meal: 'Lunch', status: 'confirmed' });
  const note = `E2E dinner ${Date.now().toString(36)}`;
  try {
    const violations = await watchCsp(page);
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/reservations/closures');
    await expectHydrated(page);
    const card = await addClosure(page, { scope: 'restaurant', target: 'pho-cuon', from: date, to: date, meals: ['Dinner'], note });

    const affected = card.getByRole('form', { name: /^Đặt bàn bị ảnh hưởng/ });
    await expect(affected.getByRole('row').filter({ hasText: dinner.reference })).toBeVisible();
    await expect(affected.getByRole('row').filter({ hasText: changed.reference })).toBeVisible();
    // A dinner closure leaves lunch alone, and lists without cancelling.
    await expect(affected.getByRole('row').filter({ hasText: lunch.reference })).toHaveCount(0);
    expect((await reservationRow(dinner.id)).status).toBe('requested');

    await affected.getByRole('checkbox', { name: `Chọn ${dinner.reference}` }).check();
    await affected.getByRole('checkbox', { name: `Chọn ${changed.reference}` }).check();
    // Someone else changes the second booking after the list was drawn.
    await one(`UPDATE reservations SET note = 'Đổi ý' WHERE id = $1`, [changed.id]);
    await affected.getByLabel('Lý do hủy', { exact: true }).fill('Nhà hàng đóng cửa ca tối');
    await affected.getByRole('button', { name: 'Hủy các đặt bàn đã chọn' }).click();
    // The page re-renders: the cancelled booking leaves the list, the outcome stays on screen. Its guest
    // gave no email, so the outcome names them, with the number to call (F2).
    const outcome = card.getByRole('status');
    await expect(outcome.getByText('Đã hủy 1 đặt bàn; 1 đặt bàn vừa thay đổi nên chưa hủy, hãy xem lại.', { exact: true })).toBeVisible();
    await expect(outcome.getByRole('listitem')).toHaveCount(1);
    await expect(outcome.getByRole('listitem')).toContainText(dinner.reference);
    await expect(card.getByRole('row').filter({ hasText: dinner.reference })).toHaveCount(0);
    expect(await reservationRow(dinner.id)).toMatchObject({ status: 'cancelled', status_reason: 'Nhà hàng đóng cửa ca tối' });
    expect((await reservationRow(changed.id)).status).toBe('confirmed');
    expect((await reservationRow(lunch.id)).status).toBe('confirmed');
    // The closure is in the audit log; the cancellation is a reservation event only (spec §7.4).
    expect(await one(`SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'closure' AND after->>'internalNote' = $1`, [note])).toEqual({ n: 1 });
    expect(await one(`SELECT count(*)::int AS n FROM reservation_events WHERE reservation_id = $1 AND to_status = 'cancelled'`, [dinner.id])).toEqual({ n: 1 });
    expect(await one(`SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'reservation'`)).toEqual({ n: 0 });
    expect(violations).toEqual([]);
  } finally {
    await one(`DELETE FROM closures WHERE internal_note = $1`, [note]);
  }
});

test('a cancel from the list emails each guest the reason only while “Báo khách qua email” is ticked (R8), and names the guests to phone', async ({ page }) => {
  // Phố Cuốn two months out, past every booking window like the tests below: the closure greys out no day another spec books.
  const date = venueDay(62);
  const note = `E2E notify ${Date.now().toString(36)}`;
  const told = await seedReservation({ restaurant: 'pho-cuon', date, time: '19:00' });
  const untold = await seedReservation({ restaurant: 'pho-cuon', date, time: '19:30', status: 'confirmed' });
  const noEmail = await seedReservation({ restaurant: 'pho-cuon', date, time: '20:00' });
  await one(`UPDATE reservations SET email = 'bulk-' || id || '@example.com' WHERE id = ANY ($1::bigint[])`, [[told.id, untold.id]]);
  try {
    await one(`INSERT INTO closures (scope, restaurant_id, starts_on, ends_on, internal_note) VALUES ('restaurant', 'pho-cuon', $1, $1, $2)`, [date, note]);
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/reservations/closures');
    await expectHydrated(page);
    const card = page.getByRole('region').filter({ hasText: note });
    const affected = card.getByRole('form', { name: /^Đặt bàn bị ảnh hưởng/ });
    const row = (reference: string) => affected.getByRole('row').filter({ hasText: reference });
    const pick = (reference: string) => affected.getByRole('checkbox', { name: `Chọn ${reference}` });
    const notify = affected.getByRole('checkbox', { name: 'Báo khách qua email (khách có email)', exact: true });
    const hint = affected.getByText('Lý do này sẽ được gửi cho khách.', { exact: true });
    const cancel = affected.getByRole('button', { name: 'Hủy các đặt bàn đã chọn' });

    // Each row carries the number to call, and marks the guest who left no email (F2).
    await expect(row(noEmail.reference).getByRole('link', { name: noEmail.phone, exact: true })).toHaveAttribute('href', `tel:${noEmail.phone}`);
    await expect(row(noEmail.reference)).toContainText('không có email');
    await expect(row(told.reference).getByRole('link', { name: told.phone, exact: true })).toHaveAttribute('href', `tel:${told.phone}`);
    await expect(row(told.reference)).not.toContainText('không có email');

    // The hint shows only while the email will quote the reason: the box on, and a ticked guest who gave an address.
    await expect(notify).toBeChecked();
    await expect(hint).toBeHidden();
    await pick(noEmail.reference).check();
    await expect(hint).toBeHidden();
    await pick(told.reference).check();
    await expect(hint).toBeVisible();
    await notify.uncheck();
    await expect(hint).toBeHidden();
    await notify.check();
    await expect(hint).toBeVisible();

    // Ticked: the guest with an address gets guest.cancelled; the one without is named, with the number to
    // call, in the outcome, which stays once the cancelled rows leave the list (F2).
    await affected.getByLabel('Lý do hủy', { exact: true }).fill('Bếp sửa chữa');
    await cancel.click();
    const outcome = affected.getByRole('status');
    await expect(outcome.getByText('Đã hủy 2 đặt bàn.', { exact: true })).toBeVisible();
    await expect(outcome).toContainText('1 khách chưa được báo qua email, hãy gọi điện:');
    await expect(outcome.getByRole('listitem')).toHaveCount(1);
    await expect(outcome.getByRole('listitem')).toContainText(noEmail.reference);
    await expect(outcome.getByRole('link', { name: noEmail.phone, exact: true })).toHaveAttribute('href', `tel:${noEmail.phone}`);
    await expect(pick(told.reference)).toHaveCount(0);
    await expect(pick(noEmail.reference)).toHaveCount(0);
    expect((await reservationRow(noEmail.id)).status).toBe('cancelled');
    expect(
      await one(`SELECT array_agg(reservation_id::text) AS ids, array_agg(event) AS events, array_agg(to_email) AS emails FROM email_outbox WHERE reservation_id = ANY ($1::bigint[])`, [
        [told.id, noEmail.id],
      ]),
    ).toEqual({ ids: [told.id], events: ['guest.cancelled'], emails: [`bulk-${told.id}@example.com`] });
    // No cron runs in the E2E: only this action's own after() (drainAfterCommit) can send it (T4.4).
    await expect.poll(() => emailsTo(`bulk-${told.id}@example.com`).map((e) => e.subject)).toContain(`Your reservation has been cancelled (${told.reference})`);

    // Unticked: the next cancel emails no one, so that guest is named as well; nothing is left to list.
    await notify.uncheck();
    await pick(untold.reference).check();
    await expect(hint).toBeHidden();
    await affected.getByLabel('Lý do hủy', { exact: true }).fill('Bếp sửa chữa');
    await cancel.click();
    const last = card.getByRole('status');
    await expect(last.getByText('Đã hủy 1 đặt bàn.', { exact: true })).toBeVisible();
    await expect(last.getByRole('listitem')).toHaveCount(1);
    await expect(last.getByRole('listitem')).toContainText(untold.reference);
    await expect(pick(untold.reference)).toHaveCount(0);
    expect(await reservationRow(untold.id)).toMatchObject({ status: 'cancelled', status_reason: 'Bếp sửa chữa' });
    expect(await one(`SELECT count(*)::int AS n FROM email_outbox WHERE reservation_id = $1`, [untold.id])).toEqual({ n: 0 });
  } finally {
    await one(`DELETE FROM closures WHERE internal_note = $1`, [note]);
  }
});

test('after “Tải lại” the edit form shows another editor’s change, and saving it keeps that change', async ({ page }) => {
  // Two months out: past every booking window, so the closure greys no day another spec books.
  const date = venueDay(60);
  const note = `E2E edit ${Date.now().toString(36)}`;
  try {
    const { id } = (await one<{ id: string }>(
      `INSERT INTO closures (scope, restaurant_id, starts_on, ends_on, internal_note) VALUES ('restaurant', 'pho-cuon', $1, $1, $2) RETURNING id::text`,
      [date, note],
    ))!;
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/reservations/closures');
    await expectHydrated(page);
    const card = page.getByRole('region').filter({ hasText: note });
    await card.getByText('Sửa', { exact: true }).click();
    const edit = card.getByRole('form', { name: 'Sửa ngày đóng cửa' });
    await expect(edit.getByLabel('Nhà hàng', { exact: true })).toHaveValue('pho-cuon');

    // Meanwhile the Admin moves the closure to the MM Supercenter: this save is refused.
    await one(`UPDATE closures SET scope = 'destination', restaurant_id = NULL, destination_id = 'mm', updated_at = clock_timestamp(), updated_by = $2 WHERE id = $1`, [
      id,
      STAFF.admin.id,
    ]);
    await edit.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(edit.getByRole('alert')).toContainText(`Vừa được ${STAFF.admin.name} thay đổi`);
    await edit.getByRole('button', { name: 'Tải lại', exact: true }).click();

    // Reloaded, the form shows the closure as it now is, beside the new token: a save keeps the Admin's change.
    await expect(edit.getByLabel('Phạm vi', { exact: true })).toHaveValue('destination');
    await expect(edit.getByLabel('Điểm đến', { exact: true })).toHaveValue('mm');
    await expect(edit.getByLabel('Nhà hàng', { exact: true })).toHaveCount(0);
    await edit.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(edit.getByRole('status')).toHaveText('Đã lưu.');
    expect(await one(`SELECT scope, destination_id, restaurant_id FROM closures WHERE id = $1`, [id])).toEqual({
      scope: 'destination',
      destination_id: 'mm',
      restaurant_id: null,
    });
  } finally {
    await one(`DELETE FROM closures WHERE internal_note = $1`, [note]);
  }
});

test('the add form starts over after a closure for a destination, and the next add goes through', async ({ page }) => {
  // Past every booking window, like the test above.
  const date = venueDay(61);
  const stamp = Date.now().toString(36);
  const notes = [`E2E again A ${stamp}`, `E2E again B ${stamp}`];
  try {
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/reservations/closures');
    await expectHydrated(page);
    await addClosure(page, { scope: 'destination', target: 'mm', from: date, to: date, note: notes[0] });

    // Blank again, its scope and its picker in agreement: one restaurant, the restaurant picker.
    const add = page.getByRole('form', { name: 'Thêm ngày đóng cửa' });
    await expect(add.getByLabel('Phạm vi', { exact: true })).toHaveValue('restaurant');
    await expect(add.getByLabel('Điểm đến', { exact: true })).toHaveCount(0);
    await expect(add.getByLabel('Nhà hàng', { exact: true })).toHaveValue('');
    await expect(add.getByLabel('Ghi chú nội bộ (khách không thấy)', { exact: true })).toHaveValue('');

    // The next closure, without touching "Phạm vi".
    await add.getByLabel('Nhà hàng', { exact: true }).selectOption('pho-cuon');
    await add.getByLabel('Từ ngày', { exact: true }).fill(date);
    await add.getByLabel('Đến ngày', { exact: true }).fill(date);
    await add.getByLabel('Ghi chú nội bộ (khách không thấy)', { exact: true }).fill(notes[1]);
    await add.getByRole('button', { name: 'Thêm ngày đóng cửa' }).click();
    await expect(page.getByRole('region').filter({ hasText: notes[1] })).toBeVisible();
    await expect(add.getByRole('alert')).toHaveCount(0);
    expect(await one(`SELECT scope, restaurant_id, destination_id FROM closures WHERE internal_note = $1`, [notes[1]])).toEqual({
      scope: 'restaurant',
      restaurant_id: 'pho-cuon',
      destination_id: null,
    });
  } finally {
    await one(`DELETE FROM closures WHERE internal_note = ANY($1)`, [notes]);
  }
});

test('a closure of a destination greys the day out for its restaurants’ guests, with the public reason, until it is deleted', async ({ page }) => {
  const date = venueDay(11);
  const note = `E2E festival ${Date.now().toString(36)}`;
  try {
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/reservations/closures');
    await expectHydrated(page);
    const card = await addClosure(page, { scope: 'destination', target: 'mm', from: date, to: date, reasonEn: 'Closed for the lantern festival', note });
    await expect(card).toContainText('Cả ngày');

    // The guest: Yum Food Village is at the MM Supercenter.
    await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
    await page.goto(HOME_PATH);
    await page.locator('.rcard:visible', { hasText: 'Yum Food Village' }).first().click();
    const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
    const chip = drawer.locator('.daystrip .day').nth(11);
    await expect(chip).toHaveAttribute('aria-disabled', 'true');
    await expect(chip).toHaveAttribute('data-state', 'closed');
    await expect(chip).toHaveAttribute('aria-label', `${formatDay(date).label}: Closed for the lantern festival`);

    // Deleted (after a confirmation), the day is bookable again.
    await page.goto('/admin/reservations/closures');
    await expectHydrated(page);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('region').filter({ hasText: note }).getByRole('button', { name: 'Xóa ngày đóng cửa' }).click();
    await expect(page.getByRole('region').filter({ hasText: note })).toHaveCount(0);
    await page.goto(HOME_PATH);
    await page.locator('.rcard:visible', { hasText: 'Yum Food Village' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Reserve a table' }).locator('.daystrip .day').nth(11)).toHaveAttribute('data-state', 'open');
    expect(await one(`SELECT array_agg(action ORDER BY id) AS actions FROM audit_log WHERE entity_type = 'closure' AND (after->>'internalNote' = $1 OR before->>'internalNote' = $1)`, [note])).toEqual({
      actions: ['create', 'delete'],
    });
  } finally {
    await one(`DELETE FROM closures WHERE internal_note = $1`, [note]);
  }
});
