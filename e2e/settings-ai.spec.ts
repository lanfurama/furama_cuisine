import type { Page } from '@playwright/test';
import { expectHydrated } from './csp';
import { STAFF, db, expect, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * "Cấu hình AI" (spec §9.2, §7.1): Admin only. The server runs with
 * AI_PROVIDER=fake and a marker in GCP_SERVICE_ACCOUNT_KEY
 * (playwright.config.ts): the page may say the variable is set, never its value.
 */

test.describe.configure({ mode: 'serial' });
test.use({ reducedMotion: 'reduce' });

async function resetAiSettings() {
  const client = db();
  await client.connect();
  try {
    await client.query(`INSERT INTO ai_settings (id, data) VALUES (1, '{}'::jsonb) ON CONFLICT (id) DO NOTHING`);
    await client.query(`UPDATE ai_settings SET data = '{}'::jsonb, updated_at = now(), updated_by = NULL`);
  } finally {
    await client.end();
  }
}

test.beforeAll(async () => {
  await seedStaff();
  await resetAiSettings();
});
test.afterAll(resetAiSettings);

const form = (page: Page) => page.getByRole('form', { name: 'Cấu hình AI' });

test('an Editor is stopped at /admin/settings/ai, like the booking settings', async ({ page }) => {
  await signInAs(page, STAFF.editor);
  await expect(page.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link', { name: 'AI', exact: true })).toHaveCount(0);
  const res = await page.goto('/admin/settings/ai');
  expect(await res?.text()).not.toContain('Giọng thương hiệu');
  await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible();
  await expect(form(page)).toHaveCount(0);
});

test('the Admin sees the fake mode, no secret value, and the check passes every step', async ({ page }) => {
  await signInAs(page, STAFF.admin);
  const res = await page.goto('/admin/settings/ai');
  const html = (await res?.text()) ?? '';
  expect(html).not.toContain('e2e-secret-marker');
  await expect(page.getByTestId('ai-mode')).toContainText('Giả (dev)');
  await expect(page.getByRole('row', { name: /GCP_SERVICE_ACCOUNT_KEY/ })).toContainText('Có');
  await expectHydrated(page);

  await page.getByRole('button', { name: 'Kiểm tra kết nối' }).click();
  const row = page.getByRole('region', { name: 'gemini-3.8-flash · global' });
  await expect(row).toBeVisible();
  await expect(row.getByRole('listitem')).toHaveCount(4);
  for (const item of await row.getByRole('listitem').all()) await expect(item).toContainText('✓');
  expect(await page.content()).not.toContain('e2e-secret-marker');

  await page.getByLabel('Thử cả mô tả ảnh').check();
  await page.getByRole('button', { name: 'Kiểm tra kết nối' }).click();
  await expect(row.getByRole('listitem')).toHaveCount(5);
  for (const item of await row.getByRole('listitem').all()) await expect(item).toContainText('✓');
});

test('the Admin moves SEO to Claude in eu; it persists and the check shows two rows', async ({ page }) => {
  await signInAs(page, STAFF.admin);
  await page.goto('/admin/settings/ai');
  await expectHydrated(page);
  const f = form(page);
  const seo = f.getByRole('group', { name: 'SEO' });
  await seo.getByLabel('Model').selectOption('claude-sonnet-5-5');
  await seo.getByLabel('Region').selectOption('eu');
  await f.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(f.getByRole('status')).toContainText('Đã lưu cấu hình AI.');

  await page.reload();
  await expectHydrated(page);
  await expect(form(page).getByRole('group', { name: 'SEO' }).getByLabel('Model')).toHaveValue('claude-sonnet-5-5');
  await expect(form(page).getByRole('group', { name: 'SEO' }).getByLabel('Region')).toHaveValue('eu');

  await page.getByRole('button', { name: 'Kiểm tra kết nối' }).click();
  await expect(page.getByRole('region', { name: 'claude-sonnet-5-5 · eu' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'gemini-3.8-flash · global' })).toBeVisible();
});

test('a budget of "abc" is refused in Vietnamese under its own box', async ({ page }) => {
  await signInAs(page, STAFF.admin);
  await page.goto('/admin/settings/ai');
  await expectHydrated(page);
  const f = form(page);
  const budget = f.getByLabel('Ngân sách mỗi tháng (USD)');
  await budget.fill('abc');
  await f.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(budget).toHaveAccessibleDescription('Nhập một số.');
  await expect(budget).toHaveAttribute('aria-invalid', 'true');
  await expect(budget).toHaveValue('abc');
});
