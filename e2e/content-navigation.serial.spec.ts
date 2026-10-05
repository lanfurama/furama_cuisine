import type { Browser, Page } from '@playwright/test';
import { expectHydrated, watchCsp } from './csp';
import { HOME_PATH } from './paths';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * The navigation editor and the header's own words in a browser (spec §7.2
 * content/navigation and ui-text, §6.5): an Editor renames a menu item (a
 * label over 14 characters warns as it is typed, over 18 is refused) and the
 * header shows it within seconds, then History puts it back; the header's
 * RESERVE button is a ui.* key edited on "Chữ giao diện", put back with
 * "Khôi phục mặc định".
 *
 * Serial (desktop-serial): every guest page carries the menu and the header;
 * afterAll repairs by SQL, then a save, only if a step failed half-way.
 */

const SAVED = 'Đã lưu. Trang khách cập nhật ngay.';

async function guest(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  return context.newPage();
}

/** The desktop header's menu labels (as written: CSS sets them in capitals) and its gold RESERVE button, freshly loaded. */
async function header(visitor: Page): Promise<{ nav: string[]; reserve: string }> {
  await visitor.goto(HOME_PATH);
  const banner = visitor.locator('.hdr-full');
  return { nav: await banner.locator('.hdr-nav .hdr-link').allTextContents(), reserve: (await banner.locator('.btn-gold').textContent()) ?? '' };
}

test.beforeAll(() => seedStaff());

test.afterAll(async ({ browser }) => {
  const broken = await one(
    `SELECT 1 AS broken WHERE EXISTS (SELECT 1 FROM nav_item_i18n t JOIN nav_items n ON n.id = t.nav_item_id
                                       WHERE n.target_section = 'offers' AND t.locale = 'en' AND t.label <> 'Offers')
        OR EXISTS (SELECT 1 FROM content_strings WHERE key = 'ui.reserve')`,
  );
  if (!broken) return;
  await one(`UPDATE nav_item_i18n SET label = 'Offers' WHERE locale = 'en' AND nav_item_id = (SELECT id FROM nav_items WHERE target_section = 'offers')`);
  await one(`DELETE FROM content_strings WHERE key = 'ui.reserve'`);
  // The SQL expires nothing: a save of the item, unchanged, does (content:nav; every guest page carries it).
  const page = await (await browser.newContext()).newPage();
  await signInAs(page, STAFF.editor);
  await page.goto('/admin/content/navigation');
  const row = page.getByRole('list', { name: 'Thứ tự menu' }).getByRole('listitem').filter({ hasText: 'Section Ưu đãi' });
  await row.getByText(/^Sửa “/).click();
  await row.getByRole('button', { name: 'Lưu mục menu' }).click();
  await expect(row.getByRole('status')).toHaveText(SAVED);
  await page.context().close();
});

test('an Editor renames a menu item: past 14 characters it warns, past 18 it is refused; the header shows it within seconds; History puts it back', async ({
  page,
  browser,
}) => {
  const csp = await watchCsp(page);
  const visitor = await guest(browser);
  try {
    expect((await header(visitor)).nav).toEqual(['Restaurants', 'Destinations', 'Experiences', 'Offers', 'Stories', 'About']);
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/content/navigation');
    await expectHydrated(page);
    // Found by its section: the item's name changes with the rename.
    const row = page.getByRole('list', { name: 'Thứ tự menu' }).getByRole('listitem').filter({ hasText: 'Section Ưu đãi' });
    await row.getByText('Sửa “Offers”').click();
    const form = row.getByRole('form', { name: 'Mục menu “Offers”' });
    const label = form.getByLabel('Nhãn', { exact: true });

    await label.fill('Offers and Events!!');
    await expect(form.getByText('19/18 ký tự · Vượt quá 18 ký tự: sẽ không lưu được.')).toBeVisible();
    await form.getByRole('button', { name: 'Lưu mục menu' }).click();
    await expect(label).toHaveAttribute('aria-invalid', 'true');
    await expect(form.getByText('Tối đa 18 ký tự.')).toBeVisible();
    // A refused save keeps what was typed.
    await expect(label).toHaveValue('Offers and Events!!');

    await label.fill('Offers & Events');
    await expect(form.getByText(/15\/18 ký tự · Dài hơn 14 ký tự/)).toBeVisible();
    await form.getByRole('button', { name: 'Lưu mục menu' }).click();
    await expect(row.getByRole('status')).toHaveText(SAVED);
    const saved = Date.now();
    await expect.poll(async () => (await header(visitor)).nav, { timeout: 10_000 }).toContain('Offers & Events');
    expect(Date.now() - saved).toBeLessThan(5000);

    const history = row.getByRole('region', { name: 'Lịch sử: Offers & Events' });
    await expect(history.getByRole('listitem').first()).toContainText('Đổi: Nhãn');
    page.once('dialog', (d) => void d.accept());
    await history.getByRole('listitem').first().getByRole('button', { name: /^Khôi phục bản trước lần này/ }).click();
    await expect.poll(async () => (await header(visitor)).nav, { timeout: 10_000 }).toContain('Offers');
    expect(csp).toEqual([]);
  } finally {
    await visitor.context().close();
  }
});

test('the header’s RESERVE is a ui.* key: an edit on “Chữ giao diện” reaches the header, and “Khôi phục mặc định” puts RESERVE back', async ({ page, browser }) => {
  const visitor = await guest(browser);
  try {
    expect((await header(visitor)).reserve).toBe('RESERVE');
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/content/ui-text');
    await expectHydrated(page);
    const form = page.getByRole('form', { name: 'Chữ giao diện' });
    const field = form.getByLabel('Nút đặt bàn ngắn (đầu trang, thanh tab điện thoại)', { exact: true });
    await field.fill('BOOK');
    await form.getByRole('button', { name: 'Lưu chữ giao diện' }).click();
    await expect(form.getByRole('status').filter({ hasText: 'Đã lưu' })).toBeVisible();
    await expect.poll(async () => (await header(visitor)).reserve, { timeout: 10_000 }).toBe('BOOK');

    await page.reload();
    await expectHydrated(page);
    const key = form.locator('[data-key="ui.reserve"]');
    await key.getByText('Ngữ cảnh và chữ mặc định').click();
    await key.getByRole('button', { name: 'Khôi phục mặc định' }).click();
    await form.getByRole('button', { name: 'Lưu chữ giao diện' }).click();
    await expect(form.getByRole('status').filter({ hasText: 'Đã lưu' })).toBeVisible();
    await expect.poll(async () => (await header(visitor)).reserve, { timeout: 10_000 }).toBe('RESERVE');
    expect(await one(`SELECT 1 FROM content_strings WHERE key = 'ui.reserve'`)).toBeUndefined();
  } finally {
    await visitor.context().close();
  }
});
