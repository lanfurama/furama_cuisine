import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { nextLink } from './email-log';
import { STAFF, expect, formAlert, newVisitor, one, seedStaff, signIn, signInAs, test, withAdminCountLock } from './staff-fixtures';

/*
 * The staff screen (spec §7.2 /admin/users): invite, resend, revoke, the
 * email-failure notice, the last-Admin rule, ban and removal, and the
 * Editor's 403. Accounts a test changes are its own; the seeded three are
 * only signed in with.
 */

test.beforeAll(() => seedStaff());

const unique = () => `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;

async function openUsers(page: Page) {
  await signInAs(page, STAFF.admin);
  await page.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link', { name: 'Nhân viên' }).click();
  await expect(page.getByRole('heading', { name: 'Nhân viên', level: 1 })).toBeVisible();
}

const invitationItem = (page: Page, email: string) => page.getByRole('list', { name: 'Lời mời đang chờ' }).locator(`li[data-email="${email}"]`);
const staffRow = (page: Page, email: string) => page.getByRole('row').filter({ hasText: email });

async function invite(page: Page, email: string) {
  // Role queries: the sign-in page we came from is still mounted, hidden (<Activity>), with an Email field of its own.
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
  await page.getByRole('combobox', { name: 'Vai trò', exact: true }).selectOption('editor');
  await page.getByRole('button', { name: 'Gửi lời mời' }).click();
  await expect(page.getByRole('main').getByRole('status')).toHaveText('Đã gửi lời mời.');
  await expect(invitationItem(page, email)).toBeVisible();
}

test('an Admin invites; resend replaces the link; revoke closes it', async ({ page, browser }, testInfo) => {
  const email = `invitee-${unique()}@furama.test`;
  await openUsers(page);
  await invite(page, email);
  const first = await nextLink(email, '/admin/accept-invite');

  const item = invitationItem(page, email);
  await item.getByRole('button', { name: 'Gửi lại' }).click();
  await expect(item.getByRole('status')).toHaveText('Đã gửi lại.');
  const second = await nextLink(email, '/admin/accept-invite', 1);
  expect(second).not.toBe(first);

  const visitor = await newVisitor(browser, testInfo);
  await visitor.goto(first);
  await expect(visitor.getByRole('main').getByRole('alert')).toContainText('Lời mời không hợp lệ');
  await visitor.goto(second);
  await expect(visitor.getByRole('button', { name: 'Tạo tài khoản' })).toBeVisible();

  await item.getByRole('button', { name: 'Thu hồi' }).click();
  await expect(item).toHaveCount(0);
  expect(await one('SELECT revoked_at IS NOT NULL AS revoked FROM staff_invitation WHERE email = $1', [email])).toEqual({ revoked: true });
  await visitor.goto(second);
  await expect(visitor.getByRole('main').getByRole('alert')).toContainText('Lời mời không hợp lệ');
});

test('an invitation whose email failed says so, on the staff screen and the overview', async ({ page }) => {
  const email = `failed-${unique()}@furama.test`;
  const unsent = `unsent-${unique()}@furama.test`;
  const insert = (address: string, emailError: string) =>
    one(
      `INSERT INTO staff_invitation (email, role, token_hash, expires_at, email_error)
       VALUES ($1, 'editor', encode(sha256(convert_to($1, 'UTF8')), 'hex'), now() + interval '7 days', $2)`,
      [address, emailError],
    );
  await insert(email, 'provider_error: Resend rejected the email: rate limited');
  // Log mode on a Vercel deployment: nothing was sent, and Gửi lại alone will not change that.
  await insert(unsent, 'not_delivered: EMAIL_DELIVERY is log (or unset) on a Vercel preview deployment');
  await signInAs(page, STAFF.admin);
  await expect(page.getByRole('region', { name: 'Lời mời chưa gửi được email' }).getByText(email)).toBeVisible();
  await page.getByRole('link', { name: 'Mở trang Nhân viên để gửi lại' }).click();
  await expect(invitationItem(page, email).getByRole('alert')).toHaveText('Chưa gửi được email, bấm Gửi lại.');
  await expect(invitationItem(page, unsent).getByRole('alert')).toHaveText(
    'Chưa gửi được email: chưa cấu hình gửi email trên môi trường này. Báo bộ phận kỹ thuật, rồi bấm Gửi lại.',
  );
});

test('the last Admin cannot demote themselves', async ({ page }) => {
  await openUsers(page);
  await withAdminCountLock(async () => {
    const row = staffRow(page, STAFF.admin.email);
    await row.getByRole('combobox').selectOption('editor');
    await expect(row.getByRole('alert')).toHaveText('Không thể hạ quyền, khóa hoặc xóa Admin cuối cùng.');
    await expect(row.getByRole('combobox')).toHaveValue('admin');
    expect(await one('SELECT role FROM staff_user WHERE email = $1', [STAFF.admin.email])).toEqual({ role: 'admin' });
  });
});

test('ban ends the member’s session and keeps them out; unban lets them back', async ({ page, browser }, testInfo) => {
  const id = unique();
  const member = { id: `e2e-ban-${id}`, name: 'Sẽ Bị Khóa', email: `ban-${id}@furama.test`, password: 'ban me passphrase', role: 'editor', banned: false } as const;
  await seedStaff([member]);
  const memberPage = await newVisitor(browser, testInfo);
  await signInAs(memberPage, member);

  await openUsers(page);
  const row = staffRow(page, member.email);
  await row.getByRole('button', { name: 'Khóa' }).click();
  await expect(row.getByRole('cell', { name: 'Đã khóa' })).toBeVisible();

  await memberPage.reload();
  await expect(memberPage).toHaveURL(/\/admin\/sign-in$/);
  await signIn(memberPage, member.email, member.password);
  await expect(formAlert(memberPage)).toHaveText('Tài khoản này đã bị khóa. Liên hệ Admin để được mở lại.');

  await row.getByRole('button', { name: 'Mở khóa' }).click();
  await expect(row.getByRole('cell', { name: 'Hoạt động' })).toBeVisible();
  await expect(memberPage.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeEnabled();
  await signIn(memberPage, member.email, member.password);
  await expect(memberPage).toHaveURL(/\/admin$/);
  expect(await one(`SELECT count(*)::int AS n FROM audit_log WHERE entity_id = $1 AND action IN ('staff.ban', 'staff.unban')`, [member.id])).toEqual({ n: 2 });
});

test('remove deletes the account, after a confirmation', async ({ page }) => {
  const id = unique();
  const member = { id: `e2e-remove-${id}`, name: 'Sẽ Bị Xóa', email: `remove-${id}@furama.test`, password: 'remove passphrase', role: 'editor', banned: false } as const;
  await seedStaff([member]);
  await openUsers(page);
  page.once('dialog', (dialog) => dialog.accept());
  await staffRow(page, member.email).getByRole('button', { name: 'Xóa' }).click();
  await expect(staffRow(page, member.email)).toHaveCount(0);
  expect(await one('SELECT 1 AS found FROM staff_user WHERE id = $1', [member.id])).toBeUndefined();
  expect(await one(`SELECT actor_email FROM audit_log WHERE entity_id = $1 AND action = 'staff.remove'`, [member.id])).toEqual({
    actor_email: STAFF.admin.email,
  });
});

test('an Editor has no Nhân viên link, and /admin/users shows the 403 view with no staff data', async ({ page }) => {
  await signInAs(page, STAFF.editor);
  await expect(page.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link')).toHaveText(['Tổng quan']);
  // Status 200, not 403: see app/admin/layout.tsx. What matters is what the response holds.
  const res = await page.goto('/admin/users');
  const body = (await res?.text()) ?? '';
  expect(body).not.toContain(STAFF.admin.email);
  expect(body).not.toContain(STAFF.banned.email);
  await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible();
  await expect(page.getByTestId('staff-name')).toHaveText(STAFF.editor.name); // still inside the shell
  await expect(page.getByRole('table')).toHaveCount(0);
});
