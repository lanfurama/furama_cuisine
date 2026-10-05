import type { Browser, Page } from '@playwright/test';
import { expectHydrated, watchCsp } from './csp';
import { HOME_PATH } from './paths';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * Spec §14.1 row 7 ACCEPTANCE, in a browser: an Editor edits an offer, then
 * deletes it, and restores it both times from History (spec §7.5); after each
 * save the guest's home page shows the change on its next load (updateTag,
 * spec §6.2). Also: the list's keyboard reorder and the restore of the old
 * order. It changes what every guest page reads (the offers), so it runs in
 * the desktop-serial project, and puts the seed back through the same
 * restores (R21); `afterAll` repairs the rows by SQL and runs the daily cron
 * (it expires content:offers) only if a step failed half-way. The admin's
 * nonce CSP must block nothing the kit draws (watchCsp).
 */

const SEED = ['Seafood & Steak Buffet Dinner', 'Vietnamese Cooking Class', 'Afternoon Tea & Dessert Buffet'];
const EDITED = 'Cooking Class with Chef Hép';

async function guest(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  return context.newPage();
}

/** The offer titles a guest sees, in order (each card's title line). */
async function guestTitles(visitor: Page): Promise<string[]> {
  await visitor.goto(HOME_PATH);
  return visitor.locator('#offers .offer-title').allTextContents();
}

/** Polls the guest page until it shows `titles`; returns how long that took after the save (spec: "within seconds"). */
async function expectGuest(visitor: Page, titles: string[], savedAt: number): Promise<number> {
  await expect.poll(() => guestTitles(visitor), { timeout: 10_000 }).toEqual(titles);
  return Date.now() - savedAt;
}

const accept = (page: Page) => page.once('dialog', (d) => void d.accept());

test.beforeAll(() => seedStaff());

test.afterAll(async ({ request }) => {
  // Only if a step failed between the delete and its restore: offer 2 as migration 008 seeded it.
  const missing = !(await one('SELECT 1 AS x FROM offers WHERE id = 2'));
  const edited = await one<{ title: string }>(`SELECT title FROM offer_i18n WHERE offer_id = 2 AND locale = 'en' AND title <> $1`, [SEED[1]]);
  if (!missing && !edited) return;
  await one(
    `INSERT INTO offers (id, restaurant_id, price_amount, currency, price_basis, sort_order) OVERRIDING SYSTEM VALUE
     VALUES (2, 'taya-house', 799000, 'VND', 'plus_plus', 20) ON CONFLICT (id) DO NOTHING`,
  );
  await one(
    `INSERT INTO offer_i18n (offer_id, locale, title, schedule, origin) VALUES (2, 'en', $1, 'Daily 11:00 or 14:00', 'seed')
     ON CONFLICT (offer_id, locale) DO UPDATE SET title = EXCLUDED.title, schedule = EXCLUDED.schedule`,
    [SEED[1]],
  );
  await request.get('/api/cron/daily', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
});

test('ACCEPTANCE: an Editor edits an offer and restores the version before, deletes it and restores it; the guest page follows each time', async ({ page, browser }) => {
  const visitor = await guest(browser);
  const csp = await watchCsp(page);
  try {
    expect(await guestTitles(visitor)).toEqual(SEED);
    await signInAs(page, STAFF.editor);
    // From the nav: Nội dung → Ưu đãi → the offer.
    await page.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link', { name: 'Nội dung' }).click();
    await page.getByRole('link', { name: 'Ưu đãi' }).click();
    await page.getByRole('list', { name: 'Thứ tự ưu đãi' }).getByRole('link', { name: SEED[1] }).click();
    await expect(page).toHaveURL(/\/admin\/content\/offers\/2$/);
    await expectHydrated(page);
    const form = page.getByRole('form', { name: 'Sửa ưu đãi' });
    await expect(form.getByLabel('Tiêu đề', { exact: true })).toHaveValue(SEED[1]);

    // 1. Edit.
    await form.getByLabel('Tiêu đề', { exact: true }).fill(EDITED);
    await expect(form.getByText(`${EDITED.length}/80 ký tự`)).toBeVisible();
    await form.getByRole('button', { name: 'Lưu ưu đãi' }).click();
    await expect(form.getByRole('status')).toHaveText('Đã lưu. Trang khách cập nhật ngay.');
    const editShown = await expectGuest(visitor, [SEED[0], EDITED, SEED[2]], Date.now());

    // 2. Restore the version before the edit: the newest History row undoes it.
    const history = page.getByRole('region', { name: 'Lịch sử' });
    const newest = history.getByRole('listitem').first();
    await expect(newest).toContainText('Sửa · Biên tập viên E2E');
    await expect(newest).toContainText('Đổi: Tiêu đề');
    const rowsBefore = await history.getByRole('listitem').count();
    accept(page);
    await newest.getByRole('button', { name: /^Khôi phục bản trước lần này/ }).click();
    await expect(form.getByLabel('Tiêu đề', { exact: true })).toHaveValue(SEED[1]);
    const restoreShown = await expectGuest(visitor, SEED, Date.now());
    await expect(history.getByRole('listitem')).toHaveCount(rowsBefore + 1);
    await expect(history.getByRole('listitem').first()).toContainText('Khôi phục');

    // 3. Delete.
    accept(page);
    await page.getByRole('button', { name: 'Xóa ưu đãi' }).click();
    await expect(page.getByRole('main').getByRole('status').filter({ hasText: 'Ưu đãi này đã bị xóa' })).toBeVisible();
    const deleteShown = await expectGuest(visitor, [SEED[0], SEED[2]], Date.now());

    // 4. Restore it, found from the list's "Đã xóa gần đây".
    await page.goto('/admin/content/offers');
    await page.getByRole('region', { name: 'Đã xóa gần đây' }).getByRole('link', { name: SEED[1] }).click();
    accept(page);
    await page.getByRole('region', { name: 'Lịch sử' }).getByRole('listitem').first().getByRole('button', { name: /^Khôi phục mục đã xóa/ }).click();
    await expect(page.getByRole('form', { name: 'Sửa ưu đãi' }).getByLabel('Tiêu đề', { exact: true })).toHaveValue(SEED[1]);
    const undeleteShown = await expectGuest(visitor, SEED, Date.now());
    // Same id, so the URL still works; and the list has nothing deleted left.
    await expect(page).toHaveURL(/\/admin\/content\/offers\/2$/);
    await page.goto('/admin/content/offers');
    await expect(page.getByRole('region', { name: 'Đã xóa gần đây' })).toContainText('Không có ưu đãi nào bị xóa.');

    test.info().annotations.push({ type: 'guest-latency-ms', description: [editShown, restoreShown, deleteShown, undeleteShown].join(', ') });
    for (const ms of [editShown, restoreShown, deleteShown, undeleteShown]) expect(ms).toBeLessThan(5_000);
    expect(csp).toEqual([]);
  } finally {
    await visitor.context().close();
  }
});

test('the list reorders by keyboard, saves the order for the guest, and its history restores the old order', async ({ page, browser }) => {
  const visitor = await guest(browser);
  const csp = await watchCsp(page);
  try {
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/content/offers');
    await expectHydrated(page);
    const list = page.getByRole('list', { name: 'Thứ tự ưu đãi' });
    await expect(list.getByRole('listitem')).toHaveCount(3);
    // Keyboard only: focus the button and press Enter.
    const up = list.getByRole('button', { name: `Chuyển “${SEED[2]}” lên` });
    await up.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'tới vị trí 2 trên 3' })).toHaveCount(1);
    await expect(list.getByRole('button', { name: `Chuyển “${SEED[2]}” lên` })).toBeFocused();
    await page.getByRole('button', { name: 'Lưu thứ tự' }).click();
    await expect(page.getByRole('form', { name: 'Thứ tự ưu đãi' }).getByRole('status')).toHaveText('Đã lưu thứ tự.');
    await expectGuest(visitor, [SEED[0], SEED[2], SEED[1]], Date.now());

    const history = page.getByRole('region', { name: 'Lịch sử thứ tự' });
    accept(page);
    await history.getByRole('listitem').first().getByRole('button', { name: /^Khôi phục bản trước lần này/ }).click();
    await expectGuest(visitor, SEED, Date.now());
    await expect(page.getByRole('list', { name: 'Thứ tự ưu đãi' }).getByRole('listitem').nth(1)).toContainText(SEED[1]);
    expect(csp).toEqual([]);
  } finally {
    await visitor.context().close();
  }
});
