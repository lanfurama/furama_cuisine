import type { Browser, Page } from '@playwright/test';
import sharp from 'sharp';
import { routeBlobToFake } from './blob-routes';
import { expectHydrated, watchCsp } from './csp';
import { HOME_PATH } from './paths';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * Phase 9 D11 (spec §9.3, R9-12, R9-21): alt text by AI, through the fake
 * model (AI_PROVIDER=fake: "A fake description of the image.") and the fake
 * Vercel Blob that playwright.config.ts starts.
 *
 *  1. An Editor uploads a picture without alt: after the answer, the AI's EN
 *     alt lands as "Máy dịch", waits in the review queue, "Duyệt" reviews it,
 *     and once a section shows the picture guests read the alt.
 *  2. "Viết alt bằng AI" fills the EN box and "Dịch từ EN" a language's box;
 *     nothing is saved until Lưu, which writes them reviewed.
 *  3. A static file (/assets) has no AI button, only the note to move it.
 *
 * Serial (desktop-serial): it puts its picture beside the home page's
 * Experiences list and takes it away again through History. Its upload has a
 * name of this run's own and ends in the trash.
 */

const RUN = Date.now().toString(36);
const FILE = `ban-tiec-ai-${RUN}.jpg`;
const FAKE_ALT = 'A fake description of the image.';
const SAVED = 'Đã lưu. Trang khách cập nhật ngay.';
const EN_ALT = 'Mô tả ảnh (tiếng Anh, cho trình đọc màn hình)';
const outside: string[] = [];

async function guest(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  return context.newPage();
}

const fileId = async () => (await one<{ id: string }>(`SELECT id::text FROM media WHERE pathname LIKE $1`, [`development/media/%/${FILE}`]))?.id;
const enAlt = async (id: string) => one<{ alt: string; status: string; origin: string }>(`SELECT alt, status, origin FROM media_i18n WHERE media_id = $1 AND locale = 'en'`, [id]);

test.beforeAll(() => seedStaff());
test.beforeEach(async ({ context }) => routeBlobToFake(context, outside));
test.afterEach(() => {
  expect(outside, 'requests that would have left the machine').toEqual([]);
});

test.afterAll(async ({ browser }) => {
  const id = await fileId();
  await one(`DELETE FROM ai_usage WHERE feature = 'alt'`);
  if (!id) return;
  const shown = await one(`SELECT 1 AS shown FROM sections WHERE key = 'experiences' AND image_id = $1`, [id]);
  if (shown) {
    // A step failed half-way: the original picture back by SQL, then a save of the section (unchanged) expires the guest pages.
    await one(`UPDATE sections SET image_id = (SELECT id FROM media WHERE pathname = '/assets/taya-garden.jpg') WHERE key = 'experiences'`);
    const page = await (await browser.newContext()).newPage();
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/content/sections');
    const form = page.getByRole('region', { name: 'Experiences', exact: true }).getByRole('form', { name: 'Experiences' });
    await form.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(form.getByRole('status')).toHaveText(SAVED);
    await page.context().close();
  }
  await one(`DELETE FROM media_i18n WHERE media_id = $1 AND locale <> 'en'`, [id]);
  await one(`UPDATE media SET deleted_at = now() WHERE id = $1`, [id]);
});

test('an upload without alt gets the AI’s alt as “Máy dịch”; “Duyệt” reviews it, and guests read it once a section shows the picture', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const csp = await watchCsp(page);
  await signInAs(page, STAFF.editor);
  await page.goto('/admin/media');
  await expectHydrated(page);
  const jpeg = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: '#7a4b2a' } }).jpeg().toBuffer();
  await page.getByLabel('Chọn ảnh hoặc PDF (tối đa 15 MB mỗi file)', { exact: true }).setInputFiles({ name: `Bàn tiệc AI ${RUN}.jpg`, mimeType: 'image/jpeg', buffer: jpeg });
  await expect(page.getByRole('list', { name: 'Tiến trình tải lên' }).getByRole('listitem').filter({ hasText: `Bàn tiệc AI ${RUN}.jpg` })).toContainText(
    'Đã thêm vào thư viện',
  );
  const id = (await fileId())!;
  expect(id).toBeTruthy();
  // after(): the alt arrives once the answer has gone.
  await expect.poll(() => enAlt(id), { timeout: 15_000 }).toEqual({ alt: FAKE_ALT, status: 'machine', origin: 'ai' });
  expect(await one(`SELECT actor_id, status FROM ai_usage WHERE feature = 'alt' ORDER BY id DESC LIMIT 1`)).toEqual({ actor_id: null, status: 'ok' });

  await page.goto(`/admin/media/${id}`);
  await expectHydrated(page);
  const details = page.getByRole('form', { name: 'Mô tả ảnh' });
  await expect(details.getByLabel(EN_ALT, { exact: true })).toHaveValue(FAKE_ALT);
  await expect(details.locator('.a-tag--warn').filter({ hasText: 'Máy dịch' }).first()).toBeVisible();

  // The review queue (English, alt text) lists it; "Duyệt" reviews it.
  await page.goto('/admin/translations?locale=en&kind=media');
  await expectHydrated(page);
  const review = page.getByRole('button', { name: `Duyệt: Alt ảnh ${id} (EN)` });
  await expect(review).toBeVisible();
  await review.click();
  await expect(review).toHaveCount(0);
  await expect.poll(() => enAlt(id)).toEqual({ alt: FAKE_ALT, status: 'reviewed', origin: 'ai' });
  await page.goto(`/admin/media/${id}`);
  await expect(page.getByRole('form', { name: 'Mô tả ảnh' }).locator('.a-tag').filter({ hasText: 'Đã duyệt' }).first()).toBeVisible();

  // The picture beside the Experiences list: guests hear the alt; History puts the old picture back.
  const visitor = await guest(browser);
  try {
    await page.goto('/admin/content/sections');
    await expectHydrated(page);
    const card = page.getByRole('region', { name: 'Experiences', exact: true });
    const form = card.getByRole('form', { name: 'Experiences' });
    await form.getByText(/^Chọn ảnh khác/).click();
    await form.getByRole('radio', { name: FILE }).check();
    await form.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(form.getByRole('status')).toHaveText(SAVED);
    await expect
      .poll(async () => {
        await visitor.goto(HOME_PATH);
        return visitor.locator('#experiences img').first().getAttribute('alt');
      }, { timeout: 15_000 })
      .toBe(FAKE_ALT);

    const history = card.getByRole('region', { name: 'Lịch sử: Experiences' });
    page.once('dialog', (d) => void d.accept());
    await history.getByRole('listitem').first().getByRole('button', { name: /^Khôi phục bản trước lần này/ }).click();
    await expect(history.getByRole('status')).toContainText('Đã khôi phục');
    await expect
      .poll(async () => {
        await visitor.goto(HOME_PATH);
        return visitor.locator('#experiences img').first().getAttribute('alt');
      }, { timeout: 15_000 })
      .not.toBe(FAKE_ALT);
  } finally {
    await visitor.context().close();
  }
  expect(csp).toEqual([]);
});

test('“Viết alt bằng AI” and “Dịch từ EN” fill the boxes; Lưu writes them reviewed', async ({ page }) => {
  const csp = await watchCsp(page);
  // The upload of the test above (this file runs in order, on one worker).
  const id = await fileId();
  expect(id).toBeTruthy();
  await signInAs(page, STAFF.editor);
  await page.goto(`/admin/media/${id}`);
  await expectHydrated(page);
  const details = page.getByRole('form', { name: 'Mô tả ảnh' });
  const en = details.getByLabel(EN_ALT, { exact: true });
  await en.fill('Typed by a person');
  await details.getByRole('button', { name: 'Viết alt bằng AI' }).click();
  await expect(en).toHaveValue(FAKE_ALT);
  // Filled, not saved: the row is as it was, and the call counted for the Editor.
  expect(await enAlt(id!)).toMatchObject({ status: 'reviewed', origin: 'ai' });
  expect(await one(`SELECT actor_id FROM ai_usage WHERE feature = 'alt' ORDER BY id DESC LIMIT 1`)).toEqual({ actor_id: STAFF.editor.id });

  const vi = details.getByLabel(/^Mô tả ảnh \(VI\)/);
  await expect(vi).toHaveValue('');
  await vi.locator('xpath=..').getByRole('button', { name: 'Dịch từ EN' }).click();
  await expect(vi).toHaveValue(`«vi» ${FAKE_ALT}`);

  await details.getByRole('button', { name: 'Lưu mô tả' }).click();
  await expect(details.getByRole('status')).toHaveText(/^Đã lưu/);
  expect(await enAlt(id!)).toEqual({ alt: FAKE_ALT, status: 'reviewed', origin: 'human' });
  expect(await one(`SELECT alt, status FROM media_i18n WHERE media_id = $1 AND locale = 'vi'`, [id])).toEqual({ alt: `«vi» ${FAKE_ALT}`, status: 'reviewed' });
  expect(csp).toEqual([]);
});

test('a static file has no AI button, only the note to move it to Blob first', async ({ page }) => {
  const chef = await one<{ id: string }>(`SELECT id::text FROM media WHERE pathname = '/assets/chef.jpg'`);
  await signInAs(page, STAFF.editor);
  await page.goto(`/admin/media/${chef!.id}`);
  await expectHydrated(page);
  const details = page.getByRole('form', { name: 'Mô tả ảnh' });
  await expect(details.getByText('Ảnh tĩnh: chuyển lên Blob trước để AI viết mô tả.')).toBeVisible();
  await expect(details.getByRole('button', { name: 'Viết alt bằng AI' })).toHaveCount(0);
});
