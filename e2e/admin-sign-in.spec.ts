import type { Page } from '@playwright/test';
import { STAFF, expect, formAlert, seedStaff, signIn, signInAs, test } from './staff-fixtures';

/*
 * Sign-in through the Server Action (useActionState), Better Auth's error
 * codes in Vietnamese, the 7-day HttpOnly cookie, sign-out, and the rate
 * limit stored in the database (spec §7.1, §7.3).
 */

test.beforeAll(() => seedStaff());

/** After a failed attempt: the action has settled and the form is ready again. */
const settled = (page: Page) =>
  expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeEnabled();

test('the Admin signs in, lands on ?next=, and signs out', async ({ page, context }) => {
  await page.goto('/admin?from=email');
  await expect(page).toHaveURL(`/admin/sign-in?next=${encodeURIComponent('/admin?from=email')}`);

  // Better Auth looks the address up in lower case.
  await signIn(page, 'Owner@Furama.test', STAFF.admin.password);
  await expect(page).toHaveURL(/\/admin\?from=email$/);
  await expect(page.getByTestId('staff-name')).toHaveText(STAFF.admin.name);
  const nav = page.getByRole('navigation', { name: 'Điều hướng quản trị' });
  await expect(nav.getByRole('link', { name: 'Tổng quan' })).toHaveAttribute('aria-current', 'page');
  // vi-VN on Vietnam's clock, e.g. "Thứ Sáu, 2 tháng 10, 2026".
  await expect(page.getByTestId('today')).toHaveText(/^(Thứ (Hai|Ba|Tư|Năm|Sáu|Bảy)|Chủ Nhật), \d{1,2} tháng \d{1,2}, \d{4}$/);

  const cookie = (await context.cookies()).find((c) => c.name === 'better-auth.session_token');
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Lax');
  expect(cookie?.path).toBe('/');
  // Max-Age 604800: about 7 days from now.
  expect(cookie!.expires * 1000 - Date.now()).toBeGreaterThan(6.9 * 24 * 3600 * 1000);

  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await expect(page).toHaveURL(/\/admin\/sign-in$/);
  expect((await context.cookies()).find((c) => c.name === 'better-auth.session_token')).toBeUndefined();
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/sign-in$/);
});

test('a signed-in visit to /admin/sign-in goes straight to the admin', async ({ page }) => {
  await signInAs(page, STAFF.editor);
  await expect(page.getByTestId('staff-name')).toHaveText(STAFF.editor.name);
  await page.goto('/admin/sign-in');
  await expect(page).toHaveURL(/\/admin$/);
});

test('?next= cannot leave the admin', async ({ page }) => {
  await page.goto(`/admin/sign-in?next=${encodeURIComponent('//evil.example/x')}`);
  await signIn(page, STAFF.admin.email, STAFF.admin.password);
  await expect(page).toHaveURL(/\/admin$/);
});

test('a wrong password: a Vietnamese message, the email kept', async ({ page }) => {
  await page.goto('/admin/sign-in');
  await signIn(page, STAFF.admin.email, 'sai mat khau hoan toan');
  await expect(formAlert(page)).toHaveText('Email hoặc mật khẩu không đúng.');
  await expect(page.getByRole('textbox', { name: 'Email' })).toHaveValue(STAFF.admin.email);
  await expect(page).toHaveURL(/\/admin\/sign-in$/);
});

test('field errors come from zod, in Vietnamese', async ({ page }) => {
  await page.goto('/admin/sign-in');
  await signIn(page, 'khong-phai-email', '');
  await expect(page.getByText('Nhập email công việc, ví dụ ten@furamavietnam.com.')).toBeVisible();
  await expect(page.getByText('Nhập mật khẩu.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Email' })).toHaveAttribute('aria-invalid', 'true');
});

test('a banned account is told it is locked', async ({ page }) => {
  await page.goto('/admin/sign-in');
  await signIn(page, STAFF.banned.email, STAFF.banned.password);
  await expect(formAlert(page)).toHaveText('Tài khoản này đã bị khóa. Liên hệ Admin để được mở lại.');
});

test('the fourth try within 10 s is refused, even with the right password', async ({ page }) => {
  await page.goto('/admin/sign-in');
  for (let i = 0; i < 3; i++) {
    await signIn(page, STAFF.admin.email, `sai mat khau ${i}`);
    await expect(formAlert(page)).toHaveText('Email hoặc mật khẩu không đúng.');
    await settled(page);
  }
  await signIn(page, STAFF.admin.email, STAFF.admin.password);
  await expect(formAlert(page)).toHaveText(/^Bạn đã thử quá nhiều lần\. Vui lòng thử lại sau \d+ giây\.$/);
  await expect(page).toHaveURL(/\/admin\/sign-in$/);
});

test('a forged session cookie passes the proxy, but the page sends the browser to sign-in', async ({ page, context }) => {
  await context.addCookies([{ name: 'better-auth.session_token', value: 'forged.token', url: test.info().project.use.baseURL! }]);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/sign-in$/);
  await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
});
