import type { Browser, Page } from '@playwright/test';
import { expectHydrated, watchCsp } from './csp';
import { HOME_PATH } from './paths';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * The SEO screen in a browser (spec §7.2 content/seo; phase-6 L7-13): an
 * Editor retitles the home page and guests' tabs show it within seconds,
 * then "Khôi phục mặc định" puts it back; a share picture reaches the home
 * page's og:image and, as the fallback, Tàya House's, whose shared link
 * keeps its own title; History takes the picture away again.
 *
 * Serial (desktop-serial): every guest page reads these; afterAll repairs by
 * SQL, then a save, only if a step failed half-way.
 */

const HOME_TITLE = 'Furama Cuisine — Many Flavours. Many Destinations.';
const TAYA = `${HOME_PATH}/restaurants/taya-house`;

async function guest(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  return context.newPage();
}

/** A page's tab title and its shared link's title and picture, freshly loaded. */
async function head(visitor: Page, path: string): Promise<{ title: string; ogTitle: string | null; ogImage: string | null }> {
  await visitor.goto(path);
  return visitor.evaluate(() => ({
    title: document.title,
    ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? null,
    ogImage: document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? null,
  }));
}

test.beforeAll(() => seedStaff());

test.afterAll(async ({ browser }) => {
  const broken = await one(
    `SELECT 1 AS broken WHERE EXISTS (SELECT 1 FROM site_settings WHERE og_image_id IS NOT NULL)
        OR EXISTS (SELECT 1 FROM content_strings WHERE key = 'seo.home_title')`,
  );
  if (!broken) return;
  await one(`DELETE FROM content_strings WHERE key = 'seo.home_title'`);
  // A save through the screen expires content:contact; the string's row is gone, and the save's commit is what the pages wait for.
  const page = await (await browser.newContext()).newPage();
  await signInAs(page, STAFF.editor);
  await page.goto('/admin/content/seo');
  const form = page.getByRole('form', { name: 'Ảnh chia sẻ' });
  await form.getByText(/^Chọn ảnh khác/).click();
  await form.getByRole('radio', { name: 'Không dùng ảnh' }).check();
  await form.getByRole('button', { name: 'Lưu' }).click();
  await expect(form.getByRole('status')).toHaveText('Đã lưu. Trang khách cập nhật ngay.');
  await page.context().close();
});

test('an Editor retitles the home page: guests’ tabs show it within seconds, and “Khôi phục mặc định” puts it back', async ({ page, browser }) => {
  const csp = await watchCsp(page);
  const visitor = await guest(browser);
  try {
    expect((await head(visitor, HOME_PATH)).title).toBe(HOME_TITLE);
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/content/seo');
    await expectHydrated(page);
    const form = page.getByRole('form', { name: 'Chữ SEO' });
    await form.getByLabel('Tiêu đề trang chủ (tab trình duyệt, kết quả tìm kiếm)', { exact: true }).fill('Furama Cuisine — Dining in Da Nang');
    await form.getByRole('button', { name: 'Lưu chữ seo' }).click();
    await expect(form.getByRole('status').filter({ hasText: 'Đã lưu' })).toBeVisible();
    const saved = Date.now();
    await expect.poll(async () => (await head(visitor, HOME_PATH)).title, { timeout: 10_000 }).toBe('Furama Cuisine — Dining in Da Nang');
    expect(Date.now() - saved).toBeLessThan(5000);

    await page.reload();
    await expectHydrated(page);
    const key = form.locator('[data-key="seo.home_title"]');
    await key.getByText('Ngữ cảnh và chữ mặc định').click();
    await key.getByRole('button', { name: 'Khôi phục mặc định' }).click();
    await form.getByRole('button', { name: 'Lưu chữ seo' }).click();
    await expect(form.getByRole('status').filter({ hasText: 'Đã lưu' })).toBeVisible();
    await expect.poll(async () => (await head(visitor, HOME_PATH)).title, { timeout: 10_000 }).toBe(HOME_TITLE);
    expect(await one(`SELECT 1 FROM content_strings WHERE key = 'seo.home_title'`)).toBeUndefined();
    expect(csp).toEqual([]);
  } finally {
    await visitor.context().close();
  }
});

test('a share picture reaches the home page and, as its fallback, Tàya House’s shared link, which keeps its own title (L7-13); History takes it away', async ({
  page,
  browser,
}) => {
  const csp = await watchCsp(page);
  const visitor = await guest(browser);
  try {
    expect(await head(visitor, HOME_PATH)).toMatchObject({ ogTitle: 'Furama Cuisine', ogImage: null });
    // L7-13: Tàya House's shared link is its own, not the home page's.
    expect(await head(visitor, TAYA)).toEqual({ title: 'Tàya House — Furama Cuisine', ogTitle: 'Tàya House — Furama Cuisine', ogImage: null });

    await signInAs(page, STAFF.editor);
    await page.goto('/admin/content/seo');
    await expectHydrated(page);
    const form = page.getByRole('form', { name: 'Ảnh chia sẻ' });
    await form.getByText(/^Chọn ảnh khác/).click();
    await form.getByRole('radio', { name: 'hero-beach.jpg' }).check();
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(form.getByRole('status')).toHaveText('Đã lưu. Trang khách cập nhật ngay.');
    const saved = Date.now();
    await expect.poll(async () => (await head(visitor, HOME_PATH)).ogImage, { timeout: 10_000 }).toMatch(/\/assets\/hero-beach\.jpg$/);
    expect(Date.now() - saved).toBeLessThan(5000);
    expect(await head(visitor, TAYA)).toMatchObject({ ogTitle: 'Tàya House — Furama Cuisine', ogImage: expect.stringMatching(/\/assets\/hero-beach\.jpg$/) });

    const history = page.getByRole('region', { name: 'Lịch sử: ảnh chia sẻ' });
    await expect(history.getByRole('listitem').first()).toContainText('Đổi: Ảnh chia sẻ');
    page.once('dialog', (d) => void d.accept());
    await history.getByRole('listitem').first().getByRole('button', { name: /^Khôi phục bản trước lần này/ }).click();
    await expect.poll(async () => (await head(visitor, HOME_PATH)).ogImage, { timeout: 10_000 }).toBeNull();
    expect((await head(visitor, TAYA)).ogImage).toBeNull();
    expect(csp).toEqual([]);
  } finally {
    await visitor.context().close();
  }
});
