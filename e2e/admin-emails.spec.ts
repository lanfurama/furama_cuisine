import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expectHydrated, watchCsp } from './csp';
import { emailsTo } from './email-log';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * Phase 5 email screens (spec §7.2): the Admin's "Thông báo email"
 * (recipients, the restaurants left to the shared inbox, "Gửi email thử").
 * The server runs EMAIL_DELIVERY=log, so a "sent" email is a line in
 * EMAIL_LOG_FILE. Data: recipients on Hura Izakaya under a fresh address,
 * removed afterwards. No spec running beside this one may add an 'all' or a
 * 'destination' recipient: booking-email expects the general inbox.
 */

test.beforeAll(() => seedStaff());
test.use({ reducedMotion: 'reduce' });

const main = (page: Page) => page.getByRole('main');
const nav = (page: Page) => page.getByRole('navigation', { name: 'Điều hướng quản trị' });
const unique = () => randomBytes(3).toString('hex');

test('an Editor has no notification settings: no menu item, and the 403 view', async ({ page }) => {
  await signInAs(page, STAFF.editor);
  await expect(nav(page).getByRole('link', { name: 'Thông báo email' })).toHaveCount(0);
  const res = await page.goto('/admin/settings/notifications');
  expect(await res?.text()).not.toContain('Hộp thư chung');
  await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible();
});

test('the Admin adds a recipient, sees which restaurants still go to the shared inbox, and sends a test email', async ({ page }) => {
  const address = `bep.${unique()}@furama.test`;
  const violations = await watchCsp(page);
  try {
    await signInAs(page, STAFF.admin);
    await nav(page).getByRole('link', { name: 'Thông báo email' }).click();
    await expect(page.getByRole('heading', { name: 'Thông báo email', level: 1 })).toBeVisible();
    await expectHydrated(page);
    await expect(main(page).getByTestId('delivery-mode')).toContainText('chỉ ghi log');

    const add = page.getByRole('form', { name: 'Thêm người nhận' });
    await add.getByLabel('Email người nhận', { exact: true }).fill(address);
    await add.getByLabel('Nhận thông báo của', { exact: true }).selectOption('restaurant');
    await add.getByLabel('Nhà hàng', { exact: true }).selectOption('hura-izakaya');
    await add.getByRole('button', { name: 'Thêm người nhận' }).click();
    await expect(add.getByRole('status')).toHaveText('Đã thêm người nhận.');
    await expect(main(page).getByRole('region', { name: `${address} · Nhà hàng: Hura Izakaya` })).toBeVisible();
    expect(await one(`SELECT scope, restaurant_id, locale, events, active FROM notification_recipients WHERE email = $1`, [address])).toEqual({
      scope: 'restaurant',
      restaurant_id: 'hura-izakaya',
      locale: 'vi',
      events: ['staff.new'],
      active: true,
    });
    // The same address on the same restaurant again: refused at the field.
    await add.getByLabel('Email người nhận', { exact: true }).fill(address.toUpperCase());
    await add.getByLabel('Nhận thông báo của', { exact: true }).selectOption('restaurant');
    await add.getByLabel('Nhà hàng', { exact: true }).selectOption('hura-izakaya');
    await add.getByRole('button', { name: 'Thêm người nhận' }).click();
    await expect(add.getByText('Địa chỉ này đã nhận thông báo cho cùng phạm vi.')).toBeVisible();

    // Hura Izakaya now has someone; it leaves the list of restaurants that fall back to the shared inbox.
    const uncovered = main(page).getByRole('list', { name: 'Nhà hàng chưa có người nhận' });
    await expect(uncovered.getByText('Café Indochine', { exact: true })).toBeVisible();
    await expect(uncovered.getByText('Hura Izakaya', { exact: true })).toHaveCount(0);

    const trial = page.getByRole('form', { name: 'Gửi email thử' });
    const to = `thu.${unique()}@furama.test`;
    await trial.getByLabel('Gửi tới', { exact: true }).fill(to);
    await trial.getByRole('button', { name: 'Gửi email thử' }).click();
    await expect(trial.getByRole('status')).toContainText('chỉ ghi log');
    await expect.poll(() => emailsTo(to).length).toBe(1);
    const [email] = emailsTo(to);
    expect(email.subject).toMatch(/^\[Email thử\] Đặt bàn mới FC-0000TEST: Tàya House, .* 19:00, 4 khách$/);
    expect(email.text).toContain('Nguyễn Thị Mẫu');
    expect(violations).toEqual([]);
  } finally {
    await one(`DELETE FROM notification_recipients WHERE lower(email) = lower($1)`, [address]);
  }
});
