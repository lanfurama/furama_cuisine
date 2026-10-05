import type { Browser, Page } from '@playwright/test';
import { expectHydrated, watchCsp } from './csp';
import { HOME_PATH } from './paths';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * The booking screen in a browser (spec §7.2 content/booking, §5.2
 * site_settings): an Editor makes the booking bar start on another
 * restaurant and the finder on another meal, and guests get them within
 * seconds, then History puts both back; the booking bar's button is a
 * booking.* key, put back with "Khôi phục mặc định".
 *
 * Serial (desktop-serial): every guest page reads the settings; afterAll
 * repairs by SQL, then a save, only if a step failed half-way.
 */

async function guest(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  return context.newPage();
}

/** What the booking bar's restaurant and the finder's occasion start on, freshly loaded (the server's HTML: no JS needed). */
async function defaults(visitor: Page): Promise<{ restaurant: string; occasion: string }> {
  await visitor.goto(HOME_PATH);
  return {
    restaurant: (await visitor.locator('#reserve .dd').nth(1).locator('.dd-value-text').textContent()) ?? '',
    occasion: (await visitor.locator('.finder .dd').nth(2).locator('.dd-value-text').textContent()) ?? '',
  };
}

test.beforeAll(() => seedStaff());

test.afterAll(async ({ browser }) => {
  const broken = await one(
    `SELECT 1 AS broken WHERE EXISTS (SELECT 1 FROM site_settings WHERE default_restaurant_id IS DISTINCT FROM 'taya-house' OR default_occasion IS DISTINCT FROM 'Dinner')
        OR EXISTS (SELECT 1 FROM content_strings WHERE key = 'booking.find_table')`,
  );
  if (!broken) return;
  await one(`DELETE FROM content_strings WHERE key = 'booking.find_table'`);
  // A save through the screen expires content:contact (the settings) and content:ui (the strings' cache follows it).
  const page = await (await browser.newContext()).newPage();
  await signInAs(page, STAFF.editor);
  await page.goto('/admin/content/booking');
  const form = page.getByRole('form', { name: 'Mặc định khi khách mở trang' });
  await form.getByLabel('Nhà hàng chọn sẵn', { exact: true }).selectOption('taya-house');
  await form.getByLabel('Dịp chọn sẵn ở ô tìm', { exact: true }).selectOption('Dinner');
  await form.getByRole('button', { name: 'Lưu' }).click();
  await expect(form.getByRole('status')).toHaveText('Đã lưu. Trang khách cập nhật ngay.');
  await page.context().close();
});

test('an Editor makes the booking bar start on The Fan and the finder on Lunch: guests get them within seconds; History puts both back', async ({
  page,
  browser,
}) => {
  const csp = await watchCsp(page);
  const visitor = await guest(browser);
  try {
    expect(await defaults(visitor)).toEqual({ restaurant: 'Tàya House', occasion: 'Dinner' });
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/content/booking');
    await expectHydrated(page);
    const form = page.getByRole('form', { name: 'Mặc định khi khách mở trang' });
    await form.getByLabel('Nhà hàng chọn sẵn', { exact: true }).selectOption('the-fan');
    await form.getByLabel('Dịp chọn sẵn ở ô tìm', { exact: true }).selectOption('Lunch');
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(form.getByRole('status')).toHaveText('Đã lưu. Trang khách cập nhật ngay.');
    const saved = Date.now();
    await expect.poll(() => defaults(visitor), { timeout: 10_000 }).toEqual({ restaurant: 'Steakhouse The Fan', occasion: 'Lunch' });
    expect(Date.now() - saved).toBeLessThan(5000);

    const history = page.getByRole('region', { name: 'Lịch sử: lựa chọn sẵn' });
    await expect(history.getByRole('listitem').first()).toContainText('Đổi: Nhà hàng chọn sẵn, Dịp chọn sẵn');
    page.once('dialog', (d) => void d.accept());
    await history.getByRole('listitem').first().getByRole('button', { name: /^Khôi phục bản trước lần này/ }).click();
    await expect.poll(() => defaults(visitor), { timeout: 10_000 }).toEqual({ restaurant: 'Tàya House', occasion: 'Dinner' });
    expect(csp).toEqual([]);
  } finally {
    await visitor.context().close();
  }
});

test('FIND A TABLE is a booking.* key: an edit on “Đặt bàn” reaches the booking bar, and “Khôi phục mặc định” puts it back', async ({ page, browser }) => {
  const visitor = await guest(browser);
  const button = async () => {
    await visitor.goto(HOME_PATH);
    return visitor.locator('#reserve .booking-submit').textContent();
  };
  try {
    expect(await button()).toBe('FIND A TABLE→');
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/content/booking');
    await expectHydrated(page);
    const form = page.getByRole('form', { name: 'Chữ đặt bàn' });
    await form.getByLabel('Nút “tìm bàn” của thanh đặt bàn', { exact: true }).fill('BOOK NOW');
    await form.getByRole('button', { name: 'Lưu chữ đặt bàn' }).click();
    await expect(form.getByRole('status').filter({ hasText: 'Đã lưu' })).toBeVisible();
    await expect.poll(button, { timeout: 10_000 }).toBe('BOOK NOW→');

    await page.reload();
    await expectHydrated(page);
    const key = form.locator('[data-key="booking.find_table"]');
    await key.getByText('Ngữ cảnh và chữ mặc định').click();
    await key.getByRole('button', { name: 'Khôi phục mặc định' }).click();
    await form.getByRole('button', { name: 'Lưu chữ đặt bàn' }).click();
    await expect(form.getByRole('status').filter({ hasText: 'Đã lưu' })).toBeVisible();
    await expect.poll(button, { timeout: 10_000 }).toBe('FIND A TABLE→');
    expect(await one(`SELECT 1 FROM content_strings WHERE key = 'booking.find_table'`)).toBeUndefined();
  } finally {
    await visitor.context().close();
  }
});
