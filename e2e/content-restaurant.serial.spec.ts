import type { Browser, Page } from '@playwright/test';
import { REGISTRY } from '../lib/i18n/registry';
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
