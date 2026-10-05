import type { Browser, Page } from '@playwright/test';
import { expectHydrated, watchCsp } from './csp';
import { HOME_PATH } from './paths';
import { STAFF, expect, one, openOnPhone, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * The destinations editor in a browser (spec §7.2 content/destinations): an
 * Editor rewrites a card's line and guests see it within seconds, then
 * History puts it back; hiding a destination (phase-6 ledger D1, L7-2) asks
 * first, naming how many restaurants go with it, and takes its card, its
 * restaurants and their online booking off the site until it shows again.
 * With every form open, the screen fits a 375 px phone (UX-6).
 *
 * Serial (desktop-serial): it changes what every guest page reads, and puts
 * it back through the same screen; afterAll repairs by SQL, then a save, only
 * if a step failed half-way.
 */

const SAVED = 'Đã lưu. Trang khách cập nhật ngay.';
const MM = 'Furama MM Supercenter';
const MM_RESTAURANTS = ['Yum Food Village', 'ChaoShan Hotpot'];

async function guest(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  return context.newPage();
}

/** The home page's destinations section and restaurant card names, freshly loaded. */
async function home(visitor: Page): Promise<{ destinations: string; restaurants: string[] }> {
  await visitor.goto(HOME_PATH);
  return {
    destinations: (await visitor.locator('#destinations').textContent()) ?? '',
    restaurants: await visitor.locator('#restaurants .rcard-name').allTextContents(),
  };
}

/** One destination's row on the list, with its form and History opened. */
async function openDestination(page: Page, name: string) {
  const list = page.getByRole('list', { name: 'Thứ tự điểm đến' });
  const row = list.getByRole('listitem').filter({ hasText: name });
  await row.getByText(`Sửa “${name}”`).click();
  return { list, row, form: row.getByRole('form', { name: `Điểm đến “${name}”` }), history: row.getByRole('region', { name: `Lịch sử: ${name}` }) };
}

test.beforeAll(() => seedStaff());

test.afterAll(async ({ browser }) => {
  const broken = await one(
    `SELECT 1 AS broken WHERE EXISTS (SELECT 1 FROM destinations WHERE NOT is_published)
        OR EXISTS (SELECT 1 FROM destination_i18n WHERE destination_id = 'mm' AND locale = 'en' AND card_title_2 <> 'Supercenter')`,
  );
  if (!broken) return;
  await one(`UPDATE destinations SET is_published = true WHERE NOT is_published`);
  await one(`UPDATE destination_i18n SET card_title_2 = 'Supercenter' WHERE destination_id = 'mm' AND locale = 'en'`);
  // The SQL expires nothing: a save of the card, unchanged, does (content:destinations; every guest page carries it).
  const page = await (await browser.newContext()).newPage();
  await signInAs(page, STAFF.editor);
  await page.goto('/admin/content/destinations');
  const { form } = await openDestination(page, MM);
  await form.getByRole('button', { name: 'Lưu điểm đến' }).click();
  await expect(form.getByRole('status')).toHaveText(SAVED);
  await page.context().close();
});

test('an Editor rewrites a destination card: guests see it within seconds, and History puts the old line back', async ({ page, browser }) => {
  const csp = await watchCsp(page);
  const visitor = await guest(browser);
  try {
    expect((await home(visitor)).destinations).toContain('Supercenter');
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/content/destinations');
    await expectHydrated(page);
    const { form, history } = await openDestination(page, MM);
    await form.getByLabel('Tiêu đề thẻ, dòng 2', { exact: true }).fill('Food Court');
    await form.getByRole('button', { name: 'Lưu điểm đến' }).click();
    await expect(form.getByRole('status')).toHaveText(SAVED);
    const saved = Date.now();
    await expect.poll(async () => (await home(visitor)).destinations, { timeout: 10_000 }).toContain('Food Court');
    expect(Date.now() - saved).toBeLessThan(5000);

    await expect(history.getByRole('listitem').first()).toContainText('Đổi: Tiêu đề thẻ, dòng 2');
    page.once('dialog', (d) => void d.accept());
    await history.getByRole('listitem').first().getByRole('button', { name: /^Khôi phục bản trước lần này/ }).click();
    await expect(history.getByRole('listitem').first()).toContainText('Khôi phục');
    await expect.poll(async () => (await home(visitor)).destinations, { timeout: 10_000 }).toContain('Supercenter');
    expect(csp).toEqual([]);
  } finally {
    await visitor.context().close();
  }
});

test('hiding a destination says how many restaurants go with it, then takes them off the site and off online booking; showing it brings them back (L7-2)', async ({
  page,
  browser,
  request,
}) => {
  const csp = await watchCsp(page);
  const visitor = await guest(browser);
  try {
    expect((await home(visitor)).restaurants).toEqual(expect.arrayContaining(MM_RESTAURANTS));
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/content/destinations');
    await expectHydrated(page);
    const list = page.getByRole('list', { name: 'Thứ tự điểm đến' });
    await expect(list.getByRole('listitem').filter({ hasText: MM })).toContainText('Địa điểm · 2 nhà hàng đang hiện');

    let asked = '';
    page.once('dialog', (d) => {
      asked = d.message();
      void d.accept();
    });
    await list.getByRole('button', { name: `Ẩn “${MM}”` }).click();
    await expect(list.getByRole('button', { name: `Hiện “${MM}”` })).toBeVisible();
    expect(asked).toContain('2 nhà hàng đang hiện của điểm đến này sẽ biến khỏi web');
    await expect
      .poll(async () => {
        const now = await home(visitor);
        return [now.destinations.includes('Supercenter'), MM_RESTAURANTS.some((r) => now.restaurants.includes(r))];
      }, { timeout: 10_000 })
      .toEqual([false, false]);
    const off = await request.get('/api/availability?restaurant=yum-food-village');
    expect(off.status()).toBe(404);
    expect(await off.json()).toEqual({ error: 'restaurant_unavailable' });

    await list.getByRole('button', { name: `Hiện “${MM}”` }).click();
    await expect(list.getByRole('button', { name: `Ẩn “${MM}”` })).toBeVisible();
    await expect.poll(async () => (await home(visitor)).restaurants, { timeout: 10_000 }).toEqual(expect.arrayContaining(MM_RESTAURANTS));
    expect((await request.get('/api/availability?restaurant=yum-food-village')).status()).toBe(200);
    expect(csp).toEqual([]);
  } finally {
    await visitor.context().close();
  }
});

test('the destinations screen fits a 375 px phone with every form open: the card-kind select stays inside its field (UX-6)', async ({ page }) => {
  await signInAs(page, STAFF.editor);
  const { scrollWidth, clientWidth } = await openOnPhone(page, '/admin/content/destinations');
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});
