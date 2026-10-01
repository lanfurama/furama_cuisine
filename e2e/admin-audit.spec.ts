import { randomBytes } from 'node:crypto';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/* /admin/audit (spec §7.2): Admin only, newest first, in Vietnamese. */

test.beforeAll(() => seedStaff());

test('the Admin reads a role change, with who did it and when', async ({ page }) => {
  const entity = `e2e-audit-${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  await one(
    `INSERT INTO audit_log (actor_id, actor_email, action, entity_type, entity_id, before, after)
     VALUES ($1, $2, 'staff.role', 'staff_user', $3, '{"role":"editor"}', '{"role":"admin"}')`,
    [STAFF.admin.id, STAFF.admin.email, entity],
  );
  await signInAs(page, STAFF.admin);
  await page.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link', { name: 'Nhật ký' }).click();
  await expect(page.getByRole('heading', { name: 'Nhật ký', level: 1 })).toBeVisible();

  const row = page.getByRole('row').filter({ hasText: entity });
  await expect(row.getByRole('cell').nth(0)).toHaveText(/^\d{2}:\d{2} \d{2}\/\d{2}\/\d{4}$/);
  await expect(row.getByRole('cell').nth(1)).toHaveText(STAFF.admin.email);
  await expect(row.getByRole('cell').nth(2)).toHaveText('Đổi vai trò');
  await expect(row.getByRole('cell').nth(3)).toHaveText(`Nhân viên · ${entity}`);
  await row.getByText('Xem').click();
  await expect(row.locator('pre')).toContainText('"role": "admin"');
});

test('an Editor gets the 403 view and no audit rows', async ({ page }) => {
  await signInAs(page, STAFF.editor);
  await expect(page.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link', { name: 'Nhật ký' })).toHaveCount(0);
  const res = await page.goto('/admin/audit');
  expect(await res?.text()).not.toContain(STAFF.admin.email);
  await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
});
