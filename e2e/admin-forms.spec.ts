import { randomBytes } from 'node:crypto';
import { expectHydrated, watchCsp } from './csp';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * The auth, staff and settings forms on the shared form kit (plan 7B task
 * B10; the phase-3 ledger's form items): a refused invitation keeps the
 * email typed, and one that goes through starts the form over; a reset link
 * that no longer works offers a new one; on the staff table a refused ban or
 * removal says so under its own buttons, in a cell that keeps the table's
 * borders. Accounts a test changes are its own.
 */

test.beforeAll(() => seedStaff());

const unique = () => `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;

test('a refused invitation keeps the email typed; one that goes through starts the form over', async ({ page }) => {
  const violations = await watchCsp(page);
  await signInAs(page, STAFF.admin);
  await page.goto('/admin/users');
  await expectHydrated(page);
  const form = page.getByRole('form', { name: 'Mời nhân viên' });
  const email = form.getByRole('textbox', { name: 'Email', exact: true });
  const role = form.getByRole('combobox', { name: 'Vai trò', exact: true });
  await email.fill(STAFF.editor.email);
  await role.selectOption('admin');
  await form.getByRole('button', { name: 'Gửi lời mời' }).click();
  await expect(form.getByRole('alert')).toHaveText('Email này đã có tài khoản nhân viên.');
  await expect(email).toHaveValue(STAFF.editor.email);
  await expect(role).toHaveValue('admin');

  const invitee = `kept-${unique()}@furama.test`;
  await email.fill(invitee);
  await role.selectOption('editor');
  await form.getByRole('button', { name: 'Gửi lời mời' }).click();
  await expect(form.getByRole('status')).toHaveText('Đã gửi lời mời.');
  await expect(email).toHaveValue('');
  expect(await one(`SELECT role FROM staff_invitation WHERE email = $1`, [invitee])).toEqual({ role: 'editor' });
  expect(violations).toEqual([]);
});

test('a reset link that no longer works says so and offers a new one', async ({ page }) => {
  await page.goto(`/admin/reset-password?token=${randomBytes(24).toString('base64url')}`);
  await expectHydrated(page);
  const password = page.getByLabel('Mật khẩu mới (12–128 ký tự)', { exact: true });
  await password.fill('a new passphrase 2026');
  await page.getByRole('button', { name: 'Đặt mật khẩu' }).click();
  const alert = page.getByRole('main').getByRole('alert');
  await expect(alert).toContainText('Liên kết không hợp lệ hoặc đã được dùng. Hãy yêu cầu một liên kết mới.');
  await expect(password).toHaveValue('a new passphrase 2026');
  await alert.getByRole('link', { name: 'Gửi lại liên kết đặt lại mật khẩu' }).click();
  await expect(page).toHaveURL(/\/admin\/reset-password$/);
  await expect(page.getByRole('button', { name: 'Gửi liên kết' })).toBeVisible();
});

test('a refused ban says so under its own buttons, in a cell that keeps the table’s borders', async ({ page }) => {
  const id = unique();
  const member = { id: `e2e-gone-${id}`, name: 'Đã Rời Đi', email: `gone-${id}@furama.test`, password: 'gone passphrase 1', role: 'editor', banned: false } as const;
  await seedStaff([member]);
  await signInAs(page, STAFF.admin);
  await page.goto('/admin/users');
  await expectHydrated(page);
  const row = page.getByRole('row').filter({ hasText: member.email });
  const cells = row.getByRole('cell');
  await expect(cells.nth(5)).toHaveCSS('display', 'table-cell');
  // Removed meanwhile, elsewhere: the ban is refused.
  await one(`DELETE FROM staff_user WHERE id = $1`, [member.id]);
  await row.getByRole('button', { name: 'Khóa' }).click();
  await expect(cells.nth(5).getByRole('alert')).toBeVisible();
  await expect(cells.nth(2).getByRole('alert')).toHaveCount(0);
});
