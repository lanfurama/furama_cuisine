import type { Page } from '@playwright/test';
import { formatDay } from '../lib/venue-time';
import { expectHydrated, watchCsp } from './csp';
import { HOME_PATH } from './paths';
import { reservationRow, seedReservation, venueDay } from './reservation-fixtures';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * Closures (spec §10.1, §14.1 phase 4): a closure made in the admin lists the
 * bookings it takes out and cancels only what staff tick, skipping one that
 * changed since the page was drawn; the guest sees the day greyed out with
 * the public reason. Phố Cuốn at +5 and the MM Supercenter (Yum Food Village,
 * ChaoShan Hotpot) at +11: dates no other spec books there. Each test deletes
 * its closure.
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
    // The page re-renders: the cancelled booking leaves the list, the outcome stays on screen.
    await expect(card.getByRole('status')).toHaveText('Đã hủy 1 đặt bàn; 1 đặt bàn vừa thay đổi nên chưa hủy, hãy xem lại.');
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
