import type { Browser, Page } from '@playwright/test';
import sharp from 'sharp';
import { REGISTRY } from '../lib/i18n/registry';
import { routeBlobToFake, type SlowPut } from './blob-routes';
import { expectHydrated, watchCsp } from './csp';
import { DETAIL_PATH, HOME_PATH } from './paths';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * The restaurant editor (spec §7.2, §7.4, §7.5) in a browser: a refused save
 * keeps what was typed and links each message to its field (phase-4/5
 * form-kit deferrals); a rename reaches the detail page's heading and, by R19,
 * the card's alt; History restores the version before. The words every
 * restaurant page shares (detail.*) are edited once, on the restaurants list.
 * It changes the catalogue every guest page reads, so it runs in the
 * desktop-serial project and restores through the same flow (R21); afterAll
 * repairs by SQL only if a step failed half-way (then the next guest visits
 * may be stale until a save).
 */

const NAME = 'Tàya House';
const RENAMED = 'Tàya Garden House';
const MORE = REGISTRY['detail.more_title'].en;
const RUN = Date.now().toString(36);
const STALE = 'Tàya House (changed by a colleague)';

async function guest(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  return context.newPage();
}

async function detailHeading(visitor: Page): Promise<string> {
  await visitor.goto(DETAIL_PATH);
  return (await visitor.getByRole('heading', { level: 1 }).textContent())?.trim() ?? '';
}

test.beforeAll(() => seedStaff());

test.afterAll(async () => {
  await one(`UPDATE restaurants SET name = $1 WHERE id = 'taya-house' AND name <> $1`, [NAME]);
  await one(
    `UPDATE media_i18n SET alt = $1 WHERE locale = 'en' AND alt <> $1 AND media_id = (SELECT card_image_id FROM restaurants WHERE id = 'taya-house')`,
    [NAME],
  );
  await one(`DELETE FROM content_strings WHERE key = 'detail.more_title'`);
});

test('a refused save keeps the typed values; a rename shows on the guest pages with the card alt (R19); History restores it', async ({ page, browser }) => {
  const visitor = await guest(browser);
  try {
    expect(await detailHeading(visitor)).toBe(NAME);
    const csp = await watchCsp(page);
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/restaurants');
    await page.getByRole('row', { name: new RegExp(NAME) }).getByRole('link', { name: 'Nội dung' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME);
    await expectHydrated(page);
    const form = page.getByRole('form', { name: 'Nội dung nhà hàng' });
    // The picker's library thumbnails (next/image, same origin) load under the admin CSP.
    const card = form.getByRole('group', { name: /^Ảnh thẻ/ });
    await card.getByText(/^Chọn ảnh khác/).click();
    await expect(card.getByRole('radio', { name: 'r-taya-house.jpg' })).toBeChecked();
    // Thumbnails are alt="" (the file name labels them), so no img role: a CSS locator is the only handle.
    await expect.poll(() => card.locator('img').first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    const name = form.getByLabel('Tên nhà hàng', { exact: true });
    const story = form.getByLabel('Câu chuyện', { exact: true });
    const storyText = await story.inputValue();

    // Refused: a page with no EN story. Typed values stay; the message is linked to its field.
    await name.fill(RENAMED);
    await story.fill('');
    await form.getByRole('button', { name: 'Lưu nhà hàng' }).click();
    await expect(form.getByRole('alert')).toContainText('Dữ liệu chưa hợp lệ');
    await expect(name).toHaveValue(RENAMED);
    const message = form.getByText('Trang chi tiết cần câu chuyện tiếng Anh.');
    await expect(message).toBeVisible();
    const messageId = await message.getAttribute('id');
    expect((await story.getAttribute('aria-describedby'))?.split(' ')).toContain(messageId);
    await expect(story).toHaveAttribute('aria-invalid', 'true');

    // Saved.
    await story.fill(storyText);
    await form.getByRole('button', { name: 'Lưu nhà hàng' }).click();
    await expect(form.getByRole('status').filter({ hasText: 'Đã lưu' })).toBeVisible();
    await expect.poll(() => detailHeading(visitor), { timeout: 10_000 }).toBe(RENAMED);
    await visitor.goto(HOME_PATH);
    await expect(visitor.locator('#restaurants').getByRole('img', { name: RENAMED, exact: true }).first()).toBeAttached();

    // History: the version before.
    const history = page.getByRole('region', { name: 'Lịch sử' });
    await expect(history.getByRole('listitem').first()).toContainText('Đổi: Tên');
    page.once('dialog', (d) => void d.accept());
    await history.getByRole('listitem').first().getByRole('button', { name: /^Khôi phục bản trước lần này/ }).click();
    await expect(form.getByLabel('Tên nhà hàng', { exact: true })).toHaveValue(NAME);
    await expect.poll(() => detailHeading(visitor), { timeout: 10_000 }).toBe(NAME);
    await visitor.goto(HOME_PATH);
    await expect(visitor.locator('#restaurants').getByRole('img', { name: NAME, exact: true }).first()).toBeAttached();
    await expect(visitor.locator('#restaurants').getByRole('img', { name: RENAMED, exact: true })).toHaveCount(0);
    expect(csp).toEqual([]);
  } finally {
    await visitor.context().close();
  }
});

/** A small PNG of this run's own, uploaded through a picker: it stays in the library, never saved into guest content. */
const png = (background: string) => sharp({ create: { width: 64, height: 48, channels: 3, background } }).png().toBuffer();

/** Tàya House's content form, hydrated, with the fake Blob behind the browser's uploads. */
async function openTaya(page: Page, outside: string[], slowPut?: SlowPut) {
  await routeBlobToFake(page.context(), outside, slowPut);
  await signInAs(page, STAFF.editor);
  await page.goto('/admin/restaurants/taya-house');
  await expectHydrated(page);
  return page.getByRole('form', { name: 'Nội dung nhà hàng' });
}

test('a colleague’s save while I type (UX-1): an upload’s refresh keeps my typing and the picked file, says the record is newer; saving is a conflict and “Tải lại” brings their version', async ({
  page,
}) => {
  const outside: string[] = [];
  const seo = await one<{ seo_title: string }>(`SELECT seo_title FROM restaurant_i18n WHERE restaurant_id = 'taya-house' AND locale = 'en'`);
  try {
    const form = await openTaya(page, outside);
    const story = form.getByLabel('Câu chuyện', { exact: true });
    const typed = `${await story.inputValue()} Typed while a colleague saved.`;
    await story.fill(typed);

    // A colleague's save: the restaurant's token changes under the open form.
    await one(`UPDATE restaurant_i18n SET seo_title = $1 WHERE restaurant_id = 'taya-house' AND locale = 'en'`, [STALE]);

    // The picker's upload refreshes the page, which brings that newer record.
    const card = form.getByRole('group', { name: /^Ảnh thẻ/ });
    await card.getByText(/^Chọn ảnh khác/).click();
    await card.getByLabel('Tải ảnh mới lên (tối đa 15 MB)', { exact: true }).setInputFiles({ name: `the-card-${RUN}.png`, mimeType: 'image/png', buffer: await png('#7a4b2a') });
    await expect(card.getByRole('list', { name: 'Tiến trình tải lên' })).toContainText('Đã thêm vào thư viện');
    await expect(form.getByRole('status').filter({ hasText: 'Có người vừa lưu bản mới của mục này' })).toBeVisible();
    await expect(story).toHaveValue(typed);
    await expect(card.getByRole('radio', { name: `the-card-${RUN}.png` })).toBeChecked();

    // Saving over it is refused; "Tải lại" drops the typing and shows their version.
    await form.getByRole('button', { name: 'Lưu nhà hàng' }).click();
    const conflict = form.getByRole('alert');
    await expect(conflict).toContainText('Hãy tải lại trang rồi làm lại.');
    await conflict.getByRole('button', { name: 'Tải lại' }).click();
    await expect(form.getByLabel('Tiêu đề SEO', { exact: true })).toHaveValue(STALE);
    await expect(story).not.toHaveValue(typed);
    await expect(form.getByText('Có người vừa lưu bản mới của mục này', { exact: false })).toHaveCount(0);
    expect(outside).toEqual([]);
  } finally {
    await one(`UPDATE restaurant_i18n SET seo_title = $1 WHERE restaurant_id = 'taya-house' AND locale = 'en'`, [seo!.seo_title]);
  }
});

test('a highlight’s picture uploads while its title is typed (UX-2): the title stays and the new picture is chosen', async ({ page }) => {
  const outside: string[] = [];
  const slow: SlowPut = { ms: 0 };
  const form = await openTaya(page, outside, slow);
  const first = form.getByRole('list', { name: 'Điểm nổi bật' }).getByRole('listitem').first();
  const title = first.getByLabel('Tiêu đề', { exact: true });
  const picker = first.getByRole('group', { name: /^Ảnh/ });
  await picker.getByText(/^Chọn ảnh khác/).click();

  slow.ms = 2_000;
  await picker.getByLabel('Tải ảnh mới lên (tối đa 15 MB)', { exact: true }).setInputFiles({ name: `the-highlight-${RUN}.png`, mimeType: 'image/png', buffer: await png('#2a4b7a') });
  const progress = picker.getByRole('list', { name: 'Tiến trình tải lên' });
  await expect(progress).toContainText('Đang tải lên…');
  await title.fill('Cooking Class typed during the upload');
  await expect(progress).toContainText('Đã thêm vào thư viện', { timeout: 10_000 });
  slow.ms = 0;

  await expect(title).toHaveValue('Cooking Class typed during the upload');
  await expect(picker.getByRole('radio', { name: `the-highlight-${RUN}.png` })).toBeChecked();
  expect(outside).toEqual([]);
  // Not saved: the next page load drops the edit (nothing reaches the guest pages).
});

test('the words every restaurant page shares are edited once, on the restaurants list: “More at …” reaches the page, and the default comes back', async ({
  page,
  browser,
}) => {
  const visitor = await guest(browser);
  const more = visitor.getByRole('heading', { level: 2, name: /at Furama Resort Danang/ });
  const form = page.getByRole('form', { name: 'Chữ trang nhà hàng' });
  const save = async (value: string) => {
    await page.goto('/admin/restaurants');
    await form.getByLabel('Tiêu đề “nhà hàng khác cùng điểm đến”', { exact: true }).fill(value);
    await form.getByRole('button', { name: 'Lưu chữ trang nhà hàng' }).click();
    await expect(form.getByRole('status')).toContainText('Đã lưu 1 mục');
  };
  try {
    await visitor.goto(DETAIL_PATH);
    await expect(more).toHaveText('More at Furama Resort Danang');
    await signInAs(page, STAFF.editor);
    try {
      await save('Also at {destination}');
      const started = Date.now();
      await visitor.reload();
      await expect(more).toHaveText('Also at Furama Resort Danang');
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      await save(MORE);
    }
    await visitor.reload();
    await expect(more).toHaveText('More at Furama Resort Danang');
    expect(await one(`SELECT 1 FROM content_strings WHERE key = 'detail.more_title'`)).toBeUndefined();
  } finally {
    await visitor.context().close();
  }
});
