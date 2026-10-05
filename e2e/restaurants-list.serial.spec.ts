import type { Browser, Page } from '@playwright/test';
import { expectHydrated, watchCsp } from './csp';
import { HOME_PATH } from './paths';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * The restaurants list (spec §7.2 /admin/restaurants) in a browser: an Editor
 * adds a restaurant (R22: a hidden draft whose id is its slug), which shows on
 * the home page once it has its card picture and type; archived, it leaves
 * (F10: never deleted), and the restaurant's History brings it back. And the
 * catalogue's order, saved and put back through its own History.
 *
 * Serial (desktop-serial): it changes the catalogue every guest page reads.
 * The new restaurant has a name of this run's own (base36) and ends archived,
 * where no guest page shows it; the order is put back through History (R21).
 */

const RUN = Date.now().toString(36);
const NAME = `E2E Bistro ${RUN}`;
const SLUG = `e2e-${RUN}`;

async function guest(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  return context.newPage();
}

/** The names of the home page's restaurant cards, in order. */
async function cardNames(visitor: Page): Promise<string[]> {
  await visitor.goto(HOME_PATH);
  return visitor.locator('#restaurants .rcard-name').allTextContents();
}

test.beforeAll(() => seedStaff());

test('an Editor adds a restaurant: hidden until it has its card and type; shown, guests see it; archived they do not, and History brings it back; it ends archived', async ({
  page,
  browser,
}) => {
  const csp = await watchCsp(page);
  const visitor = await guest(browser);
  const row = page.getByRole('row', { name: new RegExp(NAME) });
  try {
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/restaurants');
    await expectHydrated(page);
    const add = page.getByRole('form', { name: 'Thêm nhà hàng' });
    await add.getByLabel('Tên nhà hàng', { exact: true }).fill(NAME);
    await add.getByLabel('Đường dẫn (slug)', { exact: true }).fill(SLUG);
    await add.getByLabel('Điểm đến', { exact: true }).selectOption('resort');
    await add.getByRole('button', { name: 'Thêm nhà hàng' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/restaurants/${SLUG}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME);
    expect(await one(`SELECT is_published, booking_enabled FROM restaurants WHERE id = $1`, [SLUG])).toEqual({ is_published: false, booking_enabled: false });

    // On the list it is hidden, and showing it is refused until it has a card picture and a type.
    await page.goto('/admin/restaurants');
    await expect(row).toContainText('Đang ẩn');
    await row.getByRole('button', { name: `Hiện “${NAME}”` }).click();
    await expect(row.getByText('Nhà hàng đang hiện trên web cần ảnh thẻ.')).toBeVisible();
    await expect(row.getByText('Nhà hàng đang hiện trên web cần loại nhà hàng (tiếng Anh).')).toBeVisible();

    await row.getByRole('link', { name: 'Nội dung' }).click();
    await expectHydrated(page);
    const form = page.getByRole('form', { name: 'Nội dung nhà hàng' });
    const card = form.getByRole('group', { name: /^Ảnh thẻ/ });
    await card.getByText(/^Chọn ảnh khác/).click();
    await card.getByRole('radio', { name: 'r-taya-house.jpg' }).check();
    await form.getByLabel('Loại nhà hàng', { exact: true }).fill('Garden Dining');
    await form.getByRole('checkbox', { name: /^Hiện nhà hàng trên web/ }).check();
    await form.getByRole('button', { name: 'Lưu nhà hàng' }).click();
    await expect(form.getByRole('status').filter({ hasText: 'Đã lưu' })).toBeVisible();
    await expect.poll(() => cardNames(visitor), { timeout: 10_000 }).toContain(NAME);

    // Archived from the list: off the home page.
    await page.goto('/admin/restaurants');
    page.once('dialog', (d) => void d.accept());
    await row.getByRole('button', { name: `Lưu trữ “${NAME}”` }).click();
    await expect(row).toContainText('Đã lưu trữ');
    await expect.poll(() => cardNames(visitor), { timeout: 10_000 }).not.toContain(NAME);

    // Its History: the version before the archive brings it back.
    await row.getByRole('link', { name: 'Nội dung' }).click();
    const history = page.getByRole('region', { name: 'Lịch sử' });
    await expect(history.getByRole('listitem').first()).toContainText('Đổi: Lưu trữ');
    page.once('dialog', (d) => void d.accept());
    await history.getByRole('listitem').first().getByRole('button', { name: /^Khôi phục bản trước lần này/ }).click();
    await expect(history.getByRole('listitem').first()).toContainText('Khôi phục');
    await expect.poll(() => cardNames(visitor), { timeout: 10_000 }).toContain(NAME);
    expect(csp).toEqual([]);
  } finally {
    // F10: never deleted. It ends archived, through the list (the same save expires the cached pages).
    await page.goto('/admin/restaurants');
    if (await row.getByRole('button', { name: `Lưu trữ “${NAME}”` }).count()) {
      page.once('dialog', (d) => void d.accept());
      await row.getByRole('button', { name: `Lưu trữ “${NAME}”` }).click();
      await expect(row).toContainText('Đã lưu trữ');
    }
    await expect.poll(() => cardNames(visitor), { timeout: 10_000 }).not.toContain(NAME);
    await visitor.context().close();
  }
});

test('the catalogue’s order: a keyboard move saved reaches the home page, and the order’s History puts it back', async ({ page, browser }) => {
  const visitor = await guest(browser);
  try {
    const before = await cardNames(visitor);
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/restaurants');
    await expectHydrated(page);
    const list = page.getByRole('list', { name: 'Thứ tự nhà hàng' });
    const up = list.getByRole('button', { name: `Chuyển “${before[1]}” lên` });
    await up.focus();
    await page.keyboard.press('Enter');
    await expect(list.getByRole('button', { name: `Chuyển “${before[1]}” xuống` })).toBeVisible();
    await page.getByRole('form', { name: 'Thứ tự nhà hàng' }).getByRole('button', { name: 'Lưu thứ tự' }).click();
    await expect(page.getByRole('form', { name: 'Thứ tự nhà hàng' }).getByRole('status')).toHaveText('Đã lưu thứ tự.');
    await expect.poll(() => cardNames(visitor), { timeout: 10_000 }).toEqual([before[1], before[0], ...before.slice(2)]);

    const history = page.getByRole('region', { name: 'Lịch sử thứ tự nhà hàng' });
    page.once('dialog', (d) => void d.accept());
    await history.getByRole('listitem').first().getByRole('button', { name: /^Khôi phục bản trước lần này/ }).click();
    await expect(history.getByRole('listitem').first()).toContainText('Khôi phục');
    await expect.poll(() => cardNames(visitor), { timeout: 10_000 }).toEqual(before);
  } finally {
    await visitor.context().close();
  }
});
