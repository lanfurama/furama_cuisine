import type { Browser, Page } from '@playwright/test';
import { expectHydrated, watchCsp } from './csp';
import { HOME_PATH } from './paths';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * The cuisines editor in a browser (spec §7.2 content/cuisines): an Editor
 * renames a cuisine and the rail shows it within seconds, then History puts
 * it back; a cuisine of this run's own is added with a library picture,
 * shown, deleted, brought back from "Đã xóa gần đây" and deleted again; a
 * cuisine restaurants list cannot be deleted, and the refusal names them.
 *
 * Serial (desktop-serial): it changes the rail and the filters every guest
 * page reads. The added cuisine has a slug of this run's own (base36) and
 * ends deleted; afterAll repairs the rename by SQL, then a save, only if a
 * step failed half-way.
 */

const SAVED = 'Đã lưu. Trang khách cập nhật ngay.';
const RUN = Date.now().toString(36);
const SLUG = `e2e-${RUN}`;
const LABEL = `E2E ${RUN}`;

async function guest(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  return context.newPage();
}

/** The home page's cuisine chips, freshly loaded. */
async function rail(visitor: Page): Promise<string[]> {
  await visitor.goto(HOME_PATH);
  return visitor.locator('#cuisines .cuisine-label').allTextContents();
}

/** One cuisine's row on the list, with its form and History opened. */
async function openCuisine(page: Page, name: string) {
  const list = page.getByRole('list', { name: 'Thứ tự ẩm thực' });
  const row = list.getByRole('listitem').filter({ hasText: name });
  await row.getByText(`Sửa “${name}”`).click();
  return { list, row, form: row.getByRole('form', { name: `Ẩm thực “${name}”` }), history: row.getByRole('region', { name: `Lịch sử: ${name}` }) };
}

test.beforeAll(() => seedStaff());

test.afterAll(async ({ browser }) => {
  const broken = await one(`SELECT 1 AS broken FROM cuisine_i18n WHERE cuisine_id = 'thai' AND locale = 'en' AND label <> 'Thai'`);
  const added = await one(`SELECT 1 AS added FROM cuisines WHERE id = $1`, [SLUG]);
  if (!broken && !added) return;
  await one(`UPDATE cuisine_i18n SET label = 'Thai' WHERE cuisine_id = 'thai' AND locale = 'en'`);
  await one(`DELETE FROM cuisines WHERE id = $1`, [SLUG]);
  // The SQL expires nothing: a save of the cuisine, unchanged, does (content:cuisines; every guest page carries it).
  const page = await (await browser.newContext()).newPage();
  await signInAs(page, STAFF.editor);
  await page.goto('/admin/content/cuisines');
  const { form } = await openCuisine(page, 'Thai');
  await form.getByRole('button', { name: 'Lưu ẩm thực' }).click();
  await expect(form.getByRole('status')).toHaveText(SAVED);
  await page.context().close();
});

test('an Editor renames a cuisine: the rail shows it within seconds, and History puts the old name back', async ({ page, browser }) => {
  const csp = await watchCsp(page);
  const visitor = await guest(browser);
  try {
    expect(await rail(visitor)).toContain('Thai');
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/content/cuisines');
    await expectHydrated(page);
    const { row, form, history } = await openCuisine(page, 'Thai');
    await form.getByLabel('Tên ẩm thực', { exact: true }).fill('Thai & Lao');
    await form.getByRole('button', { name: 'Lưu ẩm thực' }).click();
    // The form is named after the cuisine, so after the rename it is found through its row.
    await expect(row.getByRole('status')).toHaveText(SAVED);
    const saved = Date.now();
    await expect.poll(() => rail(visitor), { timeout: 10_000 }).toContain('Thai & Lao');
    expect(Date.now() - saved).toBeLessThan(5000);

    await expect(history.getByRole('listitem').first()).toContainText('Đổi: Tên ẩm thực');
    page.once('dialog', (d) => void d.accept());
    await history.getByRole('listitem').first().getByRole('button', { name: /^Khôi phục bản trước lần này/ }).click();
    await expect(history.getByRole('listitem').first()).toContainText('Khôi phục');
    await expect.poll(() => rail(visitor), { timeout: 10_000 }).toContain('Thai');
    expect(csp).toEqual([]);
  } finally {
    await visitor.context().close();
  }
});

test('a new cuisine with a library picture reaches the rail; deleted it leaves, and “Đã xóa gần đây” brings it back; one in use cannot be deleted', async ({
  page,
  browser,
}) => {
  const csp = await watchCsp(page);
  const visitor = await guest(browser);
  try {
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/content/cuisines');
    await expectHydrated(page);
    const add = page.getByRole('form', { name: 'Thêm ẩm thực' });
    await add.getByLabel('Mã (bộ lọc)', { exact: true }).fill(SLUG);
    await add.getByLabel('Tên ẩm thực', { exact: true }).fill(LABEL);
    const picker = add.getByRole('group', { name: /^Ảnh tròn trên thanh ẩm thực/ });
    await picker.getByText(/^Chọn ảnh khác/).click();
    await picker.getByRole('radio', { name: 'cuisine-thai.jpg' }).check();
    await add.getByRole('button', { name: 'Thêm ẩm thực' }).click();
    await expect(add.getByRole('status')).toHaveText('Đã thêm ẩm thực.');
    await expect.poll(() => rail(visitor), { timeout: 10_000 }).toContain(LABEL);

    const list = page.getByRole('list', { name: 'Thứ tự ẩm thực' });
    page.once('dialog', (d) => void d.accept());
    await list.getByRole('button', { name: `Xóa “${LABEL}”` }).click();
    const deleted = page.getByRole('region', { name: 'Đã xóa gần đây' });
    await expect(deleted).toContainText(LABEL);
    await expect.poll(() => rail(visitor), { timeout: 10_000 }).not.toContain(LABEL);

    page.once('dialog', (d) => void d.accept());
    await deleted.getByRole('listitem').filter({ hasText: LABEL }).getByRole('button', { name: /^Khôi phục mục đã xóa/ }).click();
    await expect(list.getByRole('button', { name: `Xóa “${LABEL}”` })).toBeVisible();
    await expect.poll(() => rail(visitor), { timeout: 10_000 }).toContain(LABEL);

    // Thai is listed by two restaurants: refused, and the alert names them.
    page.once('dialog', (d) => void d.accept());
    await list.getByRole('button', { name: 'Xóa “Thai”' }).click();
    await expect(list.getByRole('listitem').filter({ hasText: 'Thai Siam Kitchen' }).getByRole('alert')).toContainText(
      'Ẩm thực này đang gắn với 2 nhà hàng (Thai Siam Kitchen, Yum Food Village).',
    );
    expect(csp).toEqual([]);
  } finally {
    // It ends deleted, through the list (the same delete expires the cached pages).
    const button = page.getByRole('list', { name: 'Thứ tự ẩm thực' }).getByRole('button', { name: `Xóa “${LABEL}”` });
    if (await button.count()) {
      page.once('dialog', (d) => void d.accept());
      await button.click();
      await expect(button).toHaveCount(0);
    }
    await expect.poll(() => rail(visitor), { timeout: 10_000 }).not.toContain(LABEL);
    await visitor.context().close();
  }
});
