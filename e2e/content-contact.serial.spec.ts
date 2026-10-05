import type { Browser, Page } from '@playwright/test';
import { expectHydrated, watchCsp } from './csp';
import { HOME_PATH } from './paths';
import { STAFF, expect, one, openOnPhone, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * The contact screen in a browser (spec §7.2 content/contact): an Editor
 * gives the footer's Facebook link a new address and guests follow it within
 * seconds, then History puts it back; the footer's tagline is a footer.* key
 * (also at the foot of the phone menu), put back with "Khôi phục mặc định".
 * The shared email is shown, never edited, here (R10). On a 375 px phone a
 * long link wraps in its row and "Ẩn"/"Xóa" stay on screen (UX-5).
 *
 * Serial (desktop-serial): every guest page carries the footer; afterAll
 * repairs by SQL, then a save, only if a step failed half-way.
 */

const SAVED = 'Đã lưu. Trang khách cập nhật ngay.';
const SEEDED = 'https://www.facebook.com/furamaresort';
const NEW = 'https://www.facebook.com/furamacuisine';

async function guest(browser: Browser, width = 1280): Promise<Page> {
  const context = await browser.newContext({ viewport: { width, height: 860 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  return context.newPage();
}

/** Where the footer's FACEBOOK link leads, freshly loaded. */
async function facebook(visitor: Page): Promise<string | null> {
  await visitor.goto(HOME_PATH);
  return visitor.locator('.footer-social', { hasText: 'FACEBOOK' }).getAttribute('href');
}

test.beforeAll(() => seedStaff());

test.afterAll(async ({ browser }) => {
  const broken = await one(
    `SELECT 1 AS broken WHERE EXISTS (SELECT 1 FROM social_links WHERE platform = 'facebook' AND href <> '${SEEDED}')
        OR EXISTS (SELECT 1 FROM content_strings WHERE key = 'footer.tagline')`,
  );
  if (!broken) return;
  await one(`UPDATE social_links SET href = '${SEEDED}' WHERE platform = 'facebook'`);
  await one(`DELETE FROM content_strings WHERE key = 'footer.tagline'`);
  // The SQL expires nothing: a save of the link, unchanged, expires content:contact (every guest page carries it).
  // It does not expire content:ui: after a half-failed run, the SQL-deleted tagline stays cached for guests until
  // the next strings save.
  const page = await (await browser.newContext()).newPage();
  await signInAs(page, STAFF.editor);
  await page.goto('/admin/content/contact');
  const row = page.getByRole('list', { name: 'Thứ tự mạng xã hội' }).getByRole('listitem').filter({ hasText: 'Facebook' });
  await row.getByText('Sửa “Facebook”').click();
  await row.getByRole('button', { name: 'Lưu link' }).click();
  await expect(row.getByRole('status')).toHaveText(SAVED);
  await page.context().close();
});

test('an Editor gives the footer’s Facebook link a new address: guests follow it within seconds; History puts it back; the shared email is only shown', async ({
  page,
  browser,
}) => {
  const csp = await watchCsp(page);
  const visitor = await guest(browser);
  try {
    expect(await facebook(visitor)).toBe(SEEDED);
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/content/contact');
    await expectHydrated(page);

    // R10: the shared inbox is printed, with no field; an Editor is told an Admin changes it.
    const email = page.getByRole('region', { name: 'Email chung' });
    await expect(email).toContainText('fb@furamavietnam.com');
    await expect(email.getByRole('textbox')).toHaveCount(0);
    await expect(email.getByRole('link')).toHaveCount(0);
    // R24: the venue lines are the destinations screen's.
    await expect(page.getByRole('region', { name: 'Địa chỉ ở chân trang' }).getByRole('link', { name: 'Điểm đến' })).toHaveAttribute(
      'href',
      '/admin/content/destinations',
    );

    const row = page.getByRole('list', { name: 'Thứ tự mạng xã hội' }).getByRole('listitem').filter({ hasText: 'Facebook' });
    await row.getByText('Sửa “Facebook”').click();
    const form = row.getByRole('form', { name: 'Link Facebook' });
    const href = form.getByLabel('Đường dẫn', { exact: true });
    await href.fill('http://www.facebook.com/furamacuisine');
    await form.getByRole('button', { name: 'Lưu link' }).click();
    await expect(href).toHaveAttribute('aria-invalid', 'true');
    await expect(form.getByText('Đường dẫn phải bắt đầu bằng https://')).toBeVisible();
    // A refused save keeps what was typed.
    await expect(href).toHaveValue('http://www.facebook.com/furamacuisine');

    await href.fill(NEW);
    await form.getByRole('button', { name: 'Lưu link' }).click();
    await expect(row.getByRole('status')).toHaveText(SAVED);
    const saved = Date.now();
    await expect.poll(() => facebook(visitor), { timeout: 10_000 }).toBe(NEW);
    expect(Date.now() - saved).toBeLessThan(5000);

    const history = row.getByRole('region', { name: 'Lịch sử: Facebook' });
    await expect(history.getByRole('listitem').first()).toContainText('Đổi: Đường dẫn');
    page.once('dialog', (d) => void d.accept());
    await history.getByRole('listitem').first().getByRole('button', { name: /^Khôi phục bản trước lần này/ }).click();
    await expect.poll(() => facebook(visitor), { timeout: 10_000 }).toBe(SEEDED);
    expect(csp).toEqual([]);
  } finally {
    await visitor.context().close();
  }
});

test('the footer’s tagline is a footer.* key: an edit reaches the footer and the phone menu, and “Khôi phục mặc định” puts it back', async ({
  page,
  browser,
}) => {
  const visitor = await guest(browser);
  const phone = await guest(browser, 390);
  try {
    await visitor.goto(HOME_PATH);
    await expect(visitor.locator('.footer-tagline')).toHaveText('PEOPLE | CULTURE | GREAT FOOD');
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/content/contact');
    await expectHydrated(page);
    const form = page.getByRole('form', { name: 'Chữ chân trang' });
    await form.getByLabel('Khẩu hiệu (chân trang, cuối menu điện thoại)', { exact: true }).fill('PEOPLE | PLACES | GREAT FOOD');
    await form.getByRole('button', { name: 'Lưu chữ chân trang' }).click();
    await expect(form.getByRole('status').filter({ hasText: 'Đã lưu' })).toBeVisible();
    await expect
      .poll(
        async () => {
          await visitor.goto(HOME_PATH);
          return visitor.locator('.footer-tagline').textContent();
        },
        { timeout: 10_000 },
      )
      .toBe('PEOPLE | PLACES | GREAT FOOD');
    await phone.goto(HOME_PATH);
    await phone.getByRole('button', { name: 'Open menu' }).click();
    await expect(phone.getByRole('dialog', { name: 'Menu' }).locator('.menu-tagline')).toHaveText('PEOPLE | PLACES | GREAT FOOD');

    await page.reload();
    await expectHydrated(page);
    const key = form.locator('[data-key="footer.tagline"]');
    await key.getByText('Ngữ cảnh và chữ mặc định').click();
    await key.getByRole('button', { name: 'Khôi phục mặc định' }).click();
    await form.getByRole('button', { name: 'Lưu chữ chân trang' }).click();
    await expect(form.getByRole('status').filter({ hasText: 'Đã lưu' })).toBeVisible();
    await expect
      .poll(
        async () => {
          await visitor.goto(HOME_PATH);
          return visitor.locator('.footer-tagline').textContent();
        },
        { timeout: 10_000 },
      )
      .toBe('PEOPLE | CULTURE | GREAT FOOD');
    expect(await one(`SELECT 1 FROM content_strings WHERE key = 'footer.tagline'`)).toBeUndefined();
  } finally {
    await visitor.context().close();
    await phone.context().close();
  }
});

test('the contact screen fits a 375 px phone: a long link breaks inside its row, and “Ẩn”/“Xóa” stay on screen (UX-5)', async ({ page }) => {
  await signInAs(page, STAFF.editor);
  const { scrollWidth, clientWidth } = await openOnPhone(page, '/admin/content/contact');
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  const row = page.getByRole('list', { name: 'Thứ tự mạng xã hội' }).getByRole('listitem').first();
  const remove = await row.getByRole('button', { name: /^Xóa “/ }).boundingBox();
  expect(remove!.x + remove!.width).toBeLessThanOrEqual(375);
});
