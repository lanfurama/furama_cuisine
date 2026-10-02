import type { Page } from '@playwright/test';
import { expectHydrated, watchCsp } from './csp';
import { HOME_PATH } from './paths';
import { reservationRow, seedReservation, venueDay } from './reservation-fixtures';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * "Giờ và sức chứa" (spec §10.1, §14.1 phase 4): an Editor changes the dinner
 * hours and capacity, the preview shows them in the same response and a guest
 * sees the new slots at once; a max_party override stops the guest's stepper;
 * the bookings new hours leave out are listed, and cancelled only when
 * ticked. Thai Siam Kitchen's periods and Hura Izakaya's rules: no other spec
 * reads them. Each test puts back what it changed.
 */

test.beforeAll(() => seedStaff());
test.use({ reducedMotion: 'reduce' }); // no reveal animation on the guest's booking bar

const SEED_DINNER = `UPDATE service_periods SET last_seating = '21:00', covers_per_slot = 22 WHERE restaurant_id = 'thai-siam-kitchen' AND meal = 'Dinner'`;
const CLEAR_AUDIT = `DELETE FROM audit_log WHERE entity_id IN ('thai-siam-kitchen', 'hura-izakaya')`;

/** The guest opens the drawer from a home-page card (a restaurant without its own page only reserves). */
async function openGuestDrawer(page: Page, name: string) {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  await page.goto(HOME_PATH);
  await page.locator('.rcard:visible', { hasText: name }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.daystrip .day')).toHaveCount(14);
  return drawer;
}

test('an Editor moves the last dinner seating to 22:00 with 8 covers; the preview and the guest see it at once', async ({ page }) => {
  try {
    const violations = await watchCsp(page);
    await signInAs(page, STAFF.editor);
    await page.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link', { name: 'Nhà hàng' }).click();
    await page.getByRole('row').filter({ hasText: 'Thai Siam Kitchen' }).getByRole('link', { name: 'Giờ và sức chứa' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Giờ và sức chứa · Thai Siam Kitchen');
    await page.goto(`/admin/restaurants/thai-siam-kitchen/booking?ngay=${venueDay(2)}`);
    await expectHydrated(page);
    const preview = page.getByLabel('Giờ đặt trong ngày', { exact: true });
    await expect(preview.getByText('21:00 · 22/22')).toBeVisible();
    await expect(preview.getByText(/^22:00/)).toHaveCount(0);

    const editor = page.getByRole('form', { name: 'Ca phục vụ' });
    await editor.getByLabel('Giờ cuối của ca Dinner', { exact: true }).fill('22:00');
    await editor.getByLabel('Sức chứa của ca Dinner', { exact: true }).fill('8');
    await editor.getByRole('button', { name: 'Lưu ca phục vụ' }).click();
    await expect(editor.getByRole('status')).toHaveText('Đã lưu ca phục vụ.');
    // updateTag re-rendered this page in the same response: the preview already has the new hours.
    await expect(preview.getByText('22:00 · 8/8')).toBeVisible();
    expect(
      await one(`SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'service_periods' AND entity_id = 'thai-siam-kitchen' AND actor_id = $1`, [
        STAFF.editor.id,
      ]),
    ).toEqual({ n: 1 });
    expect(violations).toEqual([]);

    // The guest, two days out: the new last sitting with its 8 covers.
    const drawer = await openGuestDrawer(page, 'Thai Siam Kitchen');
    await drawer.locator('.daystrip .day').nth(2).click();
    await expect(drawer.getByRole('button', { name: '22:00 — 8 covers left' })).toBeVisible();
  } finally {
    await one(SEED_DINNER);
    await one(CLEAR_AUDIT);
  }
});

test('a max_party override of 8 stops the guest’s stepper at 8, with the number to call', async ({ page }) => {
  try {
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/restaurants/hura-izakaya/booking');
    await expectHydrated(page);
    const rules = page.getByRole('form', { name: 'Quy tắc đặt bàn' });
    const maxParty = rules.getByLabel('Số khách tối đa', { exact: true });
    await expect(maxParty).toHaveAttribute('placeholder', '12 (mặc định)');
    await maxParty.fill('8');
    await rules.getByRole('button', { name: 'Lưu quy tắc' }).click();
    await expect(page.getByRole('form', { name: 'Quy tắc đặt bàn' }).getByRole('status')).toHaveText('Đã lưu.');
    await expect(page.getByRole('form', { name: 'Quy tắc đặt bàn' }).getByLabel('Số khách tối đa', { exact: true })).toHaveValue('8');

    const drawer = await openGuestDrawer(page, 'Hura Izakaya');
    const more = drawer.getByRole('button', { name: 'More guests' });
    for (let i = 2; i < 8; i++) await more.click();
    await expect(drawer.locator('.guests-value')).toHaveText('8 guests');
    await expect(more).toBeDisabled();
    await expect(drawer.locator('.guests-hint')).toHaveText('For more than 8 guests, please call us on 0859 555 759.');
  } finally {
    await one(`UPDATE restaurants SET max_party = NULL WHERE id = 'hura-izakaya'`);
    await one(CLEAR_AUDIT);
  }
});

test('shorter dinner hours list the bookings they leave out, and only the ticked one is cancelled', async ({ page }) => {
  const date = venueDay(3);
  const late = await seedReservation({ restaurant: 'thai-siam-kitchen', date, time: '21:00' });
  const early = await seedReservation({ restaurant: 'thai-siam-kitchen', date, time: '19:00', status: 'confirmed' });
  try {
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/restaurants/thai-siam-kitchen/booking');
    await expectHydrated(page);
    const editor = page.getByRole('form', { name: 'Ca phục vụ' });
    await editor.getByLabel('Giờ cuối của ca Dinner', { exact: true }).fill('20:00');
    await editor.getByRole('button', { name: 'Lưu ca phục vụ' }).click();
    await expect(editor.getByRole('status')).toHaveText('Đã lưu ca phục vụ.');

    const section = page.getByRole('region', { name: 'Đặt bàn sắp tới không còn khớp' });
    const list = section.getByRole('form', { name: 'Đặt bàn sắp tới không còn khớp giờ hoặc sức chứa' });
    await expect(list.getByRole('row').filter({ hasText: late.reference })).toContainText('Ngoài giờ phục vụ mới');
    await expect(list.getByRole('row').filter({ hasText: early.reference })).toHaveCount(0);
    // Listed, never cancelled on its own.
    expect((await reservationRow(late.id)).status).toBe('requested');

    await list.getByRole('checkbox', { name: `Chọn ${late.reference}` }).check();
    await list.getByLabel('Lý do hủy', { exact: true }).fill('Nhà hàng đóng bếp sớm');
    await list.getByRole('button', { name: 'Hủy các đặt bàn đã chọn' }).click();
    await expect(section.getByRole('status')).toHaveText('Đã hủy 1 đặt bàn.');
    await expect(section.getByRole('row').filter({ hasText: late.reference })).toHaveCount(0);
    expect(await reservationRow(late.id)).toMatchObject({ status: 'cancelled', status_reason: 'Nhà hàng đóng bếp sớm' });
    expect((await reservationRow(early.id)).status).toBe('confirmed');
    // The cancellation is a reservation event, the hours an audit row (spec §7.4).
    expect(await one(`SELECT count(*)::int AS n FROM reservation_events WHERE reservation_id = $1 AND to_status = 'cancelled'`, [late.id])).toEqual({ n: 1 });
  } finally {
    await one(SEED_DINNER);
    await one(CLEAR_AUDIT);
  }
});
