import type { Page } from '@playwright/test';
import sharp from 'sharp';
import { fakeBlobFiles, routeBlobToFake } from './blob-routes';
import { expectHydrated, watchCsp } from './csp';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * The media library in a browser (spec §7.2 /admin/media, §11 uploads, AC3),
 * against the fake Vercel Blob that playwright.config.ts starts: never the
 * real service. The browser PUTs to https://vercel.com/api/blob, which
 * e2e/blob-routes.ts forwards to the fake; any other host outside localhost
 * is aborted and fails the test. The admin's nonce CSP must block nothing
 * the library draws (watchCsp; thumbnails go through /_next/image, R18).
 *
 * Serial (R21): it tries to delete a file every guest page shows. Its own
 * upload has a name of this run's own (a rerun without a database reset must
 * not find the last run's file) and ends in the trash, where nothing sweeps
 * it locally.
 */

const RUN = Date.now().toString(36);
const outside: string[] = [];

async function upload(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await page.getByLabel('Chọn ảnh hoặc PDF (tối đa 15 MB mỗi file)', { exact: true }).setInputFiles({ name, mimeType, buffer });
}

const accept = (page: Page) => page.once('dialog', (d) => void d.accept());

test.beforeAll(() => seedStaff());
test.beforeEach(async ({ context }) => routeBlobToFake(context, outside));
test.afterEach(() => {
  expect(outside, 'requests that would have left the machine').toEqual([]);
});

test('an Editor uploads an image straight to the store, describes it, deletes it, and brings it back from History', async ({ page }) => {
  const csp = await watchCsp(page);
  await signInAs(page, STAFF.editor);
  await page.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link', { name: 'Thư viện' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thư viện ảnh và PDF');
  await expectHydrated(page);

  const png = await sharp({ create: { width: 320, height: 200, channels: 3, background: '#2f6b4f' } }).png().toBuffer();
  const tokenAsked = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/admin/media/upload');
  await upload(page, `Sân hiên buổi tối ${RUN}.png`, 'image/png', png);
  expect((await tokenAsked).status()).toBe(200);
  const status = page.getByRole('list', { name: 'Tiến trình tải lên' });
  await expect(status.getByRole('listitem').filter({ hasText: `Sân hiên buổi tối ${RUN}.png` })).toContainText('Đã thêm vào thư viện');

  const row = await one<{ id: string; pathname: string; width: number; height: number; storage: string; blur: boolean }>(
    `SELECT id, pathname, width, height, storage, blur_data_url IS NOT NULL AS blur FROM media WHERE pathname LIKE $1`,
    [`development/media/%/san-hien-buoi-toi-${RUN}.png`],
  );
  expect(row).toMatchObject({ width: 320, height: 200, storage: 'blob', blur: true });
  expect((await fakeBlobFiles()).map((f) => f.pathname)).toContain(row!.pathname);

  // The card's thumbnail (alt="": the link names the file) comes from /_next/image, which reads the store through the fake.
  const file = `san-hien-buoi-toi-${RUN}.png`;
  const card = page.getByRole('list', { name: 'Các file' }).getByRole('link', { name: file });
  await expect(card).toBeVisible();
  const thumb = card.locator('img');
  await expect(thumb).toHaveAttribute('src', /^\/_next\/image\?url=https%3A%2F%2Ffakestore\.public\.blob\.vercel-storage\.com%2Fdevelopment%2Fmedia%2F/);
  await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);

  await card.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(file);
  await expectHydrated(page);
  const details = page.getByRole('form', { name: 'Mô tả ảnh' });
  await details.getByLabel('Mô tả ảnh (tiếng Anh, cho trình đọc màn hình)', { exact: true }).fill('The terrace at dusk');
  await details.getByRole('button', { name: 'Lưu mô tả' }).click();
  await expect(page.getByRole('form', { name: 'Mô tả ảnh' }).getByRole('status')).toHaveText('Đã lưu.');
  expect(await one(`SELECT alt FROM media_i18n WHERE media_id = $1 AND locale = 'en'`, [row!.id])).toEqual({ alt: 'The terrace at dusk' });

  // Delete: a soft delete (R14), back to the library with a notice; the file stays in the store.
  await page.getByRole('form', { name: 'Xóa file' }).getByRole('button', { name: 'Xóa file' }).click();
  await expect(page).toHaveURL(/\/admin\/media\?deleted=1$/);
  await expect(page.getByRole('main').getByRole('status')).toContainText('Đã xóa file.');
  await expect(page.getByRole('list', { name: 'Các file' }).getByRole('link', { name: file })).toHaveCount(0);
  expect(await one(`SELECT deleted_at IS NOT NULL AS gone FROM media WHERE id = $1`, [row!.id])).toEqual({ gone: true });
  expect((await fakeBlobFiles()).map((f) => f.pathname)).toContain(row!.pathname);

  // The trash lists it; its page keeps its History, which brings it back.
  await page.getByRole('region', { name: 'Thùng rác' }).getByRole('link', { name: file }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(file);
  await expect(page.getByRole('main')).toContainText('File này đã bị xóa');
  await expectHydrated(page);
  accept(page);
  await page.getByRole('region', { name: 'Lịch sử' }).getByRole('button', { name: /^Khôi phục mục đã xóa/ }).click();
  await expect(page.getByRole('form', { name: 'Mô tả ảnh' })).toBeVisible();
  await expect(page.getByRole('form', { name: 'Mô tả ảnh' }).getByLabel('Mô tả ảnh (tiếng Anh, cho trình đọc màn hình)', { exact: true })).toHaveValue(
    'The terrace at dusk',
  );
  expect(await one(`SELECT deleted_at FROM media WHERE id = $1`, [row!.id])).toEqual({ deleted_at: null });

  // Back to the trash, where this run's file ends (nothing sweeps it locally).
  await page.getByRole('form', { name: 'Xóa file' }).getByRole('button', { name: 'Xóa file' }).click();
  await expect(page).toHaveURL(/\/admin\/media\?deleted=1$/);
  expect(csp).toEqual([]);
});

test('a file that is not what it says is refused after upload and removed from the store; a GIF never leaves the browser', async ({ page }) => {
  await signInAs(page, STAFF.editor);
  await page.goto('/admin/media');
  await expectHydrated(page);
  const status = page.getByRole('list', { name: 'Tiến trình tải lên' });
  await upload(page, `not-really-${RUN}.png`, 'image/png', Buffer.from('<html>hello</html>'));
  await expect(status.getByRole('listitem').filter({ hasText: `not-really-${RUN}.png` })).toContainText('Không đọc được ảnh (file hỏng hoặc chưa tải xong).');
  expect((await fakeBlobFiles()).some((f) => f.pathname.endsWith(`/not-really-${RUN}.png`))).toBe(false);
  expect(await one(`SELECT count(*)::int AS n FROM media WHERE pathname LIKE $1`, [`%/not-really-${RUN}.png`])).toEqual({ n: 0 });

  const asked: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/api/admin/media/upload') asked.push(r.url());
  });
  await upload(page, 'anim.gif', 'image/gif', Buffer.from('GIF89a'));
  await expect(status.getByRole('listitem').filter({ hasText: 'anim.gif' })).toContainText('Chỉ nhận JPEG, PNG, WebP, AVIF hoặc PDF.');
  expect(asked).toEqual([]);
});

test('AC3: a file the site shows cannot be deleted, and the page says where it is used', async ({ page }) => {
  const csp = await watchCsp(page);
  const chef = await one<{ id: string }>(`SELECT id FROM media WHERE pathname = '/assets/chef.jpg'`);
  await signInAs(page, STAFF.editor);
  await page.goto(`/admin/media/${chef!.id}`);
  await expectHydrated(page);
  await expect(page.getByRole('region', { name: 'Đang được dùng ở' }).getByRole('link', { name: 'Section experiences' })).toBeVisible();
  await page.getByRole('form', { name: 'Xóa file' }).getByRole('button', { name: 'Xóa file' }).click();
  const form = page.getByRole('form', { name: 'Xóa file' });
  await expect(form.getByRole('alert')).toContainText('File này đang được dùng nên không xóa được.');
  await expect(form.getByRole('list', { name: 'Nơi đang dùng file' }).getByRole('link')).toHaveText(['Section experiences']);
  expect(await one(`SELECT deleted_at FROM media WHERE id = $1`, [chef!.id])).toEqual({ deleted_at: null });
  expect(csp).toEqual([]);
});
