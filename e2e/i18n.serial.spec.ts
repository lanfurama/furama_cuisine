import type { Browser, Page } from '@playwright/test';
import { expectHydrated } from './csp';
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

test.beforeAll(() => seedStaff());
// Each test starts from the seed's languages (en on, vi off, nothing else), whatever the one before added.
test.beforeEach(resetLocales);
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

test('a content form has a tab per language: a Vietnamese save shows on /vi, and an English edit marks it "EN đã đổi"', async ({ page, browser }) => {
  const c = db();
  await c.connect();
  const { rows } = await c.query<{ title: string }>(`SELECT title FROM offer_i18n WHERE offer_id = 2 AND locale = 'en'`);
  const original = rows[0].title;
  try {
    await signInAs(page, STAFF.admin);
    await page.goto('/admin/locales');
    await row(page, 'Tiếng Việt (vi)').getByRole('button', { name: 'Bật cho khách' }).click();
    await expect(row(page, 'Tiếng Việt (vi)')).toContainText('Đang bật');

    await page.goto('/admin/content/offers/2');
    const tabs = page.getByRole('tablist', { name: 'Tiêu đề: ngôn ngữ' });
    await expect(tabs.getByRole('tab')).toHaveText(['EN', 'VIChưa dịch']);
    await tabs.getByRole('tab', { name: /VI/ }).click();
    await page.locator('input[name="title.vi"]').fill('Lớp học nấu ăn Việt');
    await page.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Đã lưu' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('tablist', { name: 'Tiêu đề: ngôn ngữ' }).getByRole('tab')).toHaveText(['EN', 'VIĐã duyệt']);

    const visitor = await guest(browser);
    await visitor.goto('/vi');
    await expect(visitor.getByText('Lớp học nấu ăn Việt').first()).toBeAttached();

    await page.locator('input[name="title.en"]').fill(`${original}!`);
    await page.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Đã lưu' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('tablist', { name: 'Tiêu đề: ngôn ngữ' }).getByRole('tab')).toHaveText(['EN', 'VIEN đã đổi']);
  } finally {
    await c.query(`DELETE FROM offer_i18n WHERE offer_id = 2 AND locale <> 'en'`);
    await c.query(`UPDATE offer_i18n SET title = $1 WHERE offer_id = 2 AND locale = 'en'`, [original]);
    await c.end();
  }
});

test('a strings screen edits one language: Vietnamese text saved on ?lang=vi shows on /vi, English stays', async ({ page, browser }) => {
  const c = db();
  await c.connect();
  try {
    await signInAs(page, STAFF.admin);
    await page.goto('/admin/locales');
    await row(page, 'Tiếng Việt (vi)').getByRole('button', { name: 'Bật cho khách' }).click();
    await expect(row(page, 'Tiếng Việt (vi)')).toContainText('Đang bật');

    await page.goto('/admin/content/stories');
    await expectHydrated(page);
    await page.getByRole('navigation', { name: 'Ngôn ngữ đang sửa' }).getByRole('link', { name: 'Tiếng Việt' }).click();
    await page.waitForURL(/\?lang=vi#strings-stories$/);
    // The screen's strings form (the cards' list has its own form of the same name).
    const form = page.locator('form').filter({ has: page.locator('[name="v:stories.title"]') });
    await expect(form).toContainText('Đang sửa: Tiếng Việt');
    await expectHydrated(page);
    const field = form.getByLabel(/^Tiêu đề mục Stories/);
    await expect(field).toHaveValue('');
    await expect(field).toHaveAttribute('placeholder', 'Stories from our Kitchens');
    await expect(form.locator('label', { hasText: 'Tiêu đề mục Stories' })).toContainText('Chưa dịch');
    await field.fill('Chuyện từ gian bếp');
    await form.getByRole('button', { name: 'Lưu stories' }).click();
    await expect(form.getByRole('status')).toContainText('Đã lưu 1 mục');
    await expect(form.locator('label', { hasText: 'Tiêu đề mục Stories' })).toContainText('Đã duyệt');

    const visitor = await guest(browser);
    await visitor.goto('/vi');
    await expect(visitor.getByRole('heading', { level: 2, name: 'Chuyện từ gian bếp' })).toBeVisible();
    await visitor.goto('/en');
    await expect(visitor.getByRole('heading', { level: 2, name: 'Stories from our Kitchens' })).toBeVisible();
    await visitor.context().close();
  } finally {
    await c.query(`DELETE FROM content_strings WHERE key = 'stories.title'`);
    await c.end();
  }
});

test('the Vietnamese email screen previews the Vietnamese being typed, the staff email too (R7, 7A ledger A4)', async ({ page }) => {
  await signInAs(page, STAFF.editor);
  await page.goto('/admin/content/emails?lang=vi');
  await expectHydrated(page);
  const form = page.getByRole('form', { name: 'Nội dung email' });
  await expect(form).toContainText('Đang sửa: Tiếng Việt');
  const heading = form.getByLabel(/^Dòng tiêu đề trong email \(Báo nhân viên: đặt bàn mới\)/);
  await expect(heading).toHaveValue('Có đặt bàn online mới');
  await heading.fill('Đặt bàn mới, chưa lưu');
  await form.getByLabel('Loại email', { exact: true }).selectOption('staff.new');
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/admin/emails/preview') && r.request().method() === 'POST'),
    form.getByRole('button', { name: 'Xem trước' }).click(),
  ]);
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain('Đặt bàn mới, chưa lưu');
  expect(body).toContain('· vi</div>');
});

test('an Editor approves a machine translation on Bản dịch: /vi shows it only once it is reviewed (serve_machine off)', async ({ page, browser }) => {
  const c = db();
  await c.connect();
  const { rows } = await c.query<{ title: string }>(`SELECT title FROM offer_i18n WHERE offer_id = 2 AND locale = 'en'`);
  const english = rows[0].title;
  const machine = 'Lớp nấu ăn (máy dịch)';
  try {
    await c.query(`INSERT INTO offer_i18n (offer_id, locale, title, status, origin, ai_model) VALUES (2, 'vi', $1, 'machine', 'ai', 'e2e')`, [machine]);
    await signInAs(page, STAFF.admin);
    await page.goto('/admin/locales');
    await row(page, 'Tiếng Việt (vi)').getByRole('button', { name: 'Bật cho khách' }).click();
    await expect(row(page, 'Tiếng Việt (vi)')).toContainText('Đang bật');

    const visitor = await guest(browser);
    const titles = () => visitor.locator('#offers .offer-title').allTextContents();
    await visitor.goto('/vi');
    expect(await titles()).toContain(english);
    expect(await titles()).not.toContain(machine);

    const editor = await (await browser.newContext()).newPage();
    await signInAs(editor, STAFF.editor);
    await editor.getByRole('link', { name: 'Bản dịch' }).click();
    await expect(editor.getByRole('heading', { level: 1, name: 'Bản dịch' })).toBeVisible();
    await editor.getByRole('combobox', { name: 'Ngôn ngữ' }).selectOption('vi');
    await editor.getByRole('combobox', { name: 'Loại' }).selectOption('offers');
    await editor.getByRole('button', { name: 'Lọc' }).click();
    const queue = editor.getByRole('form', { name: 'Hàng chờ duyệt' });
    await expect(queue.getByRole('row')).toHaveCount(2);
    await expect(queue).toContainText(machine);
    await expectHydrated(editor);
    await queue.getByRole('button', { name: /^Duyệt: Ưu đãi 2 \(VI\)$/ }).click();
    await expect(editor.getByText('Không có bản dịch nào chờ duyệt.')).toBeVisible();

    await visitor.reload();
    expect(await titles()).toContain(machine);
    await visitor.context().close();
    await editor.context().close();
  } finally {
    await c.query(`DELETE FROM offer_i18n WHERE offer_id = 2 AND locale <> 'en'`);
    await c.end();
  }
});
