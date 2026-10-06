import type { Browser, Page } from '@playwright/test';
import { STAFF, db, expect, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * Phase 8 (spec §8, §14.1 row 8): the languages screen drives the guest site
 * without a deploy. Enabling Vietnamese on /admin/locales shows the switcher
 * and opens /vi at once (the locales tag), disabling it closes both; a language
 * without its guest emails cannot be enabled (R8-6); a staff preview opens a
 * disabled language for staff only (Draft Mode, C6).
 *
 * Serial (desktop-serial): it changes which languages every guest page offers,
 * and puts the table back as migration 004 seeded it (en on, vi off) at the end.
 */

async function guest(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  return context.newPage();
}

const row = (page: Page, name: string) => page.locator('tr', { hasText: name });

async function resetLocales() {
  const c = db();
  await c.connect();
  try {
    await c.query(`DELETE FROM content_strings WHERE locale NOT IN ('en', 'vi')`);
    await c.query(`DELETE FROM locales WHERE code NOT IN ('en', 'vi')`);
    await c.query(`UPDATE locales SET is_enabled = (code = 'en'), serve_machine = false`);
  } finally {
    await c.end();
  }
}

test.beforeAll(async () => {
  await seedStaff();
  await resetLocales();
});
test.afterAll(resetLocales);

test('enabling a language on /admin/locales opens it to guests at once, and disabling it closes it', async ({ page, browser }) => {
  const visitor = await guest(browser);
  await visitor.goto('/en');
  await expect(visitor.locator('.hdr-lang-btn')).toHaveCount(0);
  expect((await visitor.goto('/vi'))?.status()).toBe(404);

  await signInAs(page, STAFF.admin);
  await page.goto('/admin/locales');
  await row(page, 'Tiếng Việt (vi)').getByRole('button', { name: 'Bật cho khách' }).click();
  await expect(row(page, 'Tiếng Việt (vi)')).toContainText('Đang bật');

  await visitor.goto('/en/restaurants/taya-house?x=1');
  await visitor.locator('.hdr-lang-btn').click();
  await Promise.all([visitor.waitForURL(/\/vi\/restaurants\/taya-house\?x=1$/), visitor.getByRole('link', { name: 'Tiếng Việt' }).click()]);
  await expect(visitor.locator('html')).toHaveAttribute('lang', 'vi');
  expect((await visitor.context().cookies()).find((c) => c.name === 'NEXT_LOCALE')?.value).toBe('vi');

  page.once('dialog', (d) => d.accept());
  await row(page, 'Tiếng Việt (vi)').getByRole('button', { name: 'Tắt' }).click();
  await expect(row(page, 'Tiếng Việt (vi)')).toContainText('Đang tắt');
  expect((await visitor.goto('/vi'))?.status()).toBe(404);
  await visitor.goto('/en');
  await expect(visitor.locator('.hdr-lang-btn')).toHaveCount(0);
});

test('a language whose guest emails are not translated cannot be enabled; staff can preview it, guests cannot', async ({ page, browser }) => {
  await signInAs(page, STAFF.admin);
  await page.goto('/admin/locales');
  await page.getByRole('form', { name: 'Thêm ngôn ngữ' }).getByLabel('Ngôn ngữ').selectOption('ko');
  await page.getByRole('button', { name: 'Thêm ngôn ngữ' }).click();
  await expect(row(page, '한국어 (ko)')).toContainText('Đang tắt');

  await row(page, '한국어 (ko)').getByRole('button', { name: 'Bật cho khách' }).click();
  await expect(row(page, '한국어 (ko)').locator('.a-warn-list')).toContainText('email gửi khách');

  const visitor = await guest(browser);
  expect((await visitor.goto('/ko'))?.status()).toBe(404);
  expect((await visitor.goto('/api/admin/preview?path=/ko'))?.status()).toBe(403);

  await page.goto('/api/admin/preview?path=/ko/restaurants/taya-house');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await expect(page.locator('.preview-banner')).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await expect(page.locator('link[href="/fonts/hangul.css"]')).toHaveCount(1);
  expect(await (await page.request.get('/sitemap.xml')).text()).not.toContain('/ko');
  await page.locator('.preview-banner a').click();
  await page.waitForURL(/\/en$/);
});

test('an Editor has no Ngôn ngữ link, and /admin/locales shows the 403 view with no languages', async ({ page }) => {
  await signInAs(page, STAFF.editor);
  await expect(page.getByRole('link', { name: 'Ngôn ngữ' })).toHaveCount(0);
  // Status 200, not 403: see app/admin/layout.tsx (as e2e/admin-users.spec.ts). What matters is what the response holds.
  await page.goto('/admin/locales');
  await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Các ngôn ngữ' })).toHaveCount(0);
});
