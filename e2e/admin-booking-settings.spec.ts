import type { Page } from '@playwright/test';
import { expectHydrated } from './csp';
import { HOME_PATH } from './paths';
import { STAFF, expect, newVisitor, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * "Cài đặt đặt bàn" and auto_confirm per restaurant are the Admin's (spec
 * §7.1): an Editor gets the 403 view and no auto-confirm control, and the
 * Admin's own action, replayed with an Editor's cookie, is refused and
 * writes nothing. Danaksara's auto_confirm: no other spec books it.
 */

test.beforeAll(() => seedStaff());
test.use({ reducedMotion: 'reduce' });

const nav = (page: Page) => page.getByRole('navigation', { name: 'Điều hướng quản trị' });
const settingsAudits = async () => (await one<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'booking_settings'`))!.n;

test('an Editor gets the 403 view on booking settings and never sees auto-confirm', async ({ page }) => {
  await signInAs(page, STAFF.editor);
  await expect(nav(page).getByRole('link', { name: 'Đặt bàn' })).toBeVisible();
  await expect(nav(page).getByRole('link', { name: 'Cài đặt đặt bàn' })).toHaveCount(0);
  const res = await page.goto('/admin/settings/booking');
  expect(await res?.text()).not.toContain('Giữ dữ liệu khách');
  await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible();
  await expect(page.getByRole('form', { name: 'Cài đặt đặt bàn' })).toHaveCount(0);

  await page.goto('/admin/restaurants/danaksara/booking');
  await expect(page.getByRole('form', { name: 'Quy tắc đặt bàn' })).toBeVisible();
  await expect(page.getByRole('form', { name: 'Tự động xác nhận' })).toHaveCount(0);
});

test('the Admin saves booking settings; the same POST from an Editor is refused and writes nothing', async ({ page, browser, baseURL }, testInfo) => {
  await signInAs(page, STAFF.admin);
  await nav(page).getByRole('link', { name: 'Cài đặt đặt bàn' }).click();
  await expect(page.getByRole('heading', { name: 'Cài đặt đặt bàn', level: 1 })).toBeVisible();
  await expectHydrated(page);
  const form = page.getByRole('form', { name: 'Cài đặt đặt bàn' });
  await expect(form.getByLabel('Số khách tối đa', { exact: true })).toHaveValue('12');
  // Save the values as they are: other specs run on these defaults.
  const before = await settingsAudits();
  const saving = page.waitForRequest((r) => r.method() === 'POST' && !!r.headers()['next-action']);
  await form.getByRole('button', { name: 'Lưu cài đặt' }).click();
  const request = await saving;
  await expect(page.getByRole('form', { name: 'Cài đặt đặt bàn' }).getByRole('status')).toHaveText('Đã lưu.');
  expect(await settingsAudits()).toBe(before + 1);

  // The Admin's captured action, replayed with an Editor's cookie (spec §13).
  const editor = await newVisitor(browser, testInfo);
  await signInAs(editor, STAFF.editor);
  const replay = await editor.request.post(new URL(request.url()).pathname, {
    headers: {
      'next-action': request.headers()['next-action'],
      'content-type': request.headers()['content-type'],
      accept: 'text/x-component',
      origin: baseURL!,
    },
    data: request.postDataBuffer()!,
  });
  expect(replay.status()).toBe(200);
  expect(await replay.text()).toContain('"code":"forbidden"');
  expect(await settingsAudits()).toBe(before + 1);
  await editor.context().close();
});

test('the Admin turns auto-confirm on for one restaurant: a guest’s booking there is confirmed at once', async ({ page }) => {
  try {
    await signInAs(page, STAFF.admin);
    await page.goto('/admin/restaurants/danaksara/booking');
    await expectHydrated(page);
    const form = page.getByRole('form', { name: 'Tự động xác nhận' });
    await form.getByLabel('Tự động xác nhận đặt bàn online (chỉ Admin)', { exact: true }).selectOption('on');
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByRole('form', { name: 'Tự động xác nhận' }).getByRole('status')).toHaveText('Đã lưu.');

    await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
    await page.goto(HOME_PATH);
    await page.locator('.rcard:visible', { hasText: 'Danaksara' }).first().click();
    const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
    await expect(drawer.locator('.daystrip .day')).toHaveCount(14);
    await drawer.locator('.daystrip .day[data-state="open"]').last().click();
    await drawer.locator('.slot:not([disabled])').first().click();
    await drawer.getByLabel('Full name *', { exact: true }).fill('Khách Tự Xác Nhận');
    const digits = String(Date.now()).slice(-6);
    await drawer.getByLabel('Phone *', { exact: true }).fill(`0906 ${digits.slice(0, 3)} ${digits.slice(3)}`);
    await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();
    const reference = (await drawer.locator('.drawer-ref').textContent()) ?? '';
    expect(reference).toMatch(/^FC-[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(await one(`SELECT status, source FROM reservations WHERE reference = $1`, [reference])).toEqual({ status: 'confirmed', source: 'web' });
  } finally {
    await one(`UPDATE restaurants SET auto_confirm = NULL WHERE id = 'danaksara'`);
  }
});
