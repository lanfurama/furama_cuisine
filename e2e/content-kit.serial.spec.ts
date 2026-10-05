import { expectHydrated, watchCsp } from './csp';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * The content editors' shared kit after the 7A review (plan 7B task B10):
 * text typed while a save is in flight stays on screen, unsaved, and the
 * next save sends it with no conflict against the first; a restore says
 * what it brought back at the top of its History, though that version is
 * no longer a choice (UX-5); an order moved but not saved asks before the
 * page is left (UX-9); on the restaurants list "Ẩn" asks first like
 * "Lưu trữ", and "Đặt bàn online" says a hidden restaurant takes no booking.
 *
 * Serial (desktop-serial): the Thai cuisine's label and ChaoShan Hotpot's
 * switch reach every guest page; each test puts them back through the
 * editors, and afterAll repairs by SQL, then a save, only if a step failed.
 */

const SAVED = 'Đã lưu. Trang khách cập nhật ngay.';

test.beforeAll(() => seedStaff());

test.afterAll(async ({ browser }) => {
  const thai = await one(`SELECT 1 AS broken FROM cuisine_i18n WHERE cuisine_id = 'thai' AND locale = 'en' AND label <> 'Thai'`);
  const hidden = await one(`SELECT 1 AS hidden FROM restaurants WHERE id = 'chaoshan-hotpot' AND NOT is_published`);
  if (!thai && !hidden) return;
  await one(`UPDATE cuisine_i18n SET label = 'Thai' WHERE cuisine_id = 'thai' AND locale = 'en'`);
  const page = await (await browser.newContext()).newPage();
  await signInAs(page, STAFF.editor);
  if (thai) {
    await page.goto('/admin/content/cuisines');
    const row = page.getByRole('list', { name: 'Thứ tự ẩm thực' }).getByRole('listitem').filter({ hasText: 'Thai' });
    await row.getByText('Sửa “Thai”').click();
    await row.getByRole('button', { name: 'Lưu ẩm thực' }).click();
    await expect(row.getByRole('status').first()).toHaveText(SAVED);
  }
  if (hidden) {
    await page.goto('/admin/restaurants');
    await page.getByRole('row', { name: /ChaoShan Hotpot/ }).getByRole('button', { name: 'Hiện “ChaoShan Hotpot”' }).click();
    await expect(page.getByRole('row', { name: /ChaoShan Hotpot/ })).toContainText('Đang hiện');
  }
  await page.context().close();
});

test('text typed while a save is in flight stays, unsaved, and the next save sends it; a restore says what it brought back (UX-5)', async ({ page }) => {
  const csp = await watchCsp(page);
  await signInAs(page, STAFF.editor);
  await page.goto('/admin/content/cuisines');
  await expectHydrated(page);
  const row = page.getByRole('list', { name: 'Thứ tự ẩm thực' }).getByRole('listitem').filter({ hasText: 'Thai' });
  await row.getByText('Sửa “Thai”').click();
  const form = row.getByRole('form', { name: /^Ẩm thực “/ });
  const label = form.getByLabel('Tên ẩm thực', { exact: true });

  // The save takes a second and a half on its way to the server: long enough to type.
  await page.route('**/admin/content/cuisines', async (route) => {
    if (route.request().method() === 'POST') await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await label.fill('Thai & Lao');
  await form.getByRole('button', { name: 'Lưu ẩm thực' }).click();
  await expect(form.getByRole('button', { name: 'Đang lưu…' })).toBeVisible();
  await label.fill('Thai, Lao & Khmer');
  await expect.poll(() => one(`SELECT label FROM cuisine_i18n WHERE cuisine_id = 'thai' AND locale = 'en'`)).toEqual({ label: 'Thai & Lao' });
  await expect(form.getByRole('button', { name: 'Lưu ẩm thực' })).toBeVisible();
  await expect(label).toHaveValue('Thai, Lao & Khmer');
  await expect(form.getByText('Có thay đổi chưa lưu.')).toBeVisible();
  await page.unroute('**/admin/content/cuisines');

  // The second save is no conflict with the first: it went out with the first save's new token.
  await form.getByRole('button', { name: 'Lưu ẩm thực' }).click();
  await expect(form.getByRole('status')).toHaveText(SAVED);
  expect(await one(`SELECT label FROM cuisine_i18n WHERE cuisine_id = 'thai' AND locale = 'en'`)).toEqual({ label: 'Thai, Lao & Khmer' });

  // Back to "Thai" through History: the oldest row's version before. Its button goes; the panel says what it did.
  const history = row.getByRole('region', { name: /^Lịch sử: / });
  page.once('dialog', (d) => void d.accept());
  await history.getByRole('listitem').last().getByRole('button', { name: /^Khôi phục bản trước lần này/ }).click();
  await expect(history.getByRole('status')).toHaveText(/^Đã khôi phục: khôi phục bản trước lần này lúc \d\d:\d\d \d\d\/\d\d\/\d{4}\.$/);
  await expect.poll(() => one(`SELECT label FROM cuisine_i18n WHERE cuisine_id = 'thai' AND locale = 'en'`)).toEqual({ label: 'Thai' });
  expect(csp).toEqual([]);
});

test('an order moved but not saved asks before the page is left; moved back, it does not (UX-9)', async ({ page }) => {
  await signInAs(page, STAFF.editor);
  await page.goto('/admin/content/cuisines');
  await expectHydrated(page);
  const list = page.getByRole('list', { name: 'Thứ tự ẩm thực' });
  const orderForm = page.getByRole('form', { name: 'Thứ tự ẩm thực' });
  await list.getByRole('button', { name: 'Chuyển “Thai” lên' }).click();
  await expect(orderForm.getByText('Thứ tự mới chưa được lưu.')).toBeVisible();

  // A reload with the order unsaved: the browser asks, and staying keeps the new order on screen.
  const asked: string[] = [];
  page.once('dialog', (dialog) => {
    asked.push(dialog.type());
    void dialog.dismiss();
  });
  await page.evaluate(() => location.reload());
  await expect.poll(() => asked).toEqual(['beforeunload']);
  await expect(orderForm.getByText('Thứ tự mới chưa được lưu.')).toBeVisible();

  // Moved back, nothing is unsaved: the reload goes through without asking, and the order is the saved one.
  await list.getByRole('button', { name: 'Chuyển “Thai” xuống' }).click();
  await expect(orderForm.getByText('Thứ tự mới chưa được lưu.')).toBeHidden();
  page.on('dialog', (dialog) => {
    asked.push(dialog.type());
    void dialog.dismiss();
  });
  await page.reload();
  await expectHydrated(page);
  expect(asked).toEqual(['beforeunload']);
  await expect(list.getByRole('listitem').nth(2)).toContainText('Thai');
  await expect(orderForm.getByRole('button', { name: 'Lưu thứ tự' })).toBeDisabled();
});

test('on the restaurants list “Ẩn” asks first, and “Đặt bàn online” says a hidden restaurant takes no booking', async ({ page }) => {
  await signInAs(page, STAFF.editor);
  await page.goto('/admin/restaurants');
  await expectHydrated(page);
  const row = page.getByRole('row', { name: /ChaoShan Hotpot/ });
  const booking = row.getByRole('cell').nth(3);
  await expect(booking).toHaveText('Bật');

  const asked: string[] = [];
  page.once('dialog', (d) => {
    asked.push(d.message());
    void d.dismiss();
  });
  await row.getByRole('button', { name: 'Ẩn “ChaoShan Hotpot”' }).click();
  await expect.poll(() => asked).toEqual([
    'Ẩn “ChaoShan Hotpot”? Nhà hàng rời web (thẻ, trang, ưu đãi, đặt bàn online); đặt bàn đã có giữ nguyên. Hiện lại được bất cứ lúc nào.',
  ]);
  // Dismissed: nothing changed.
  await expect(row).toContainText('Đang hiện');
  expect(await one(`SELECT is_published FROM restaurants WHERE id = 'chaoshan-hotpot'`)).toEqual({ is_published: true });

  page.once('dialog', (d) => void d.accept());
  await row.getByRole('button', { name: 'Ẩn “ChaoShan Hotpot”' }).click();
  await expect(row).toContainText('Đang ẩn');
  await expect(booking).toHaveText('Không nhận (đang ẩn)');
  await row.getByRole('button', { name: 'Hiện “ChaoShan Hotpot”' }).click();
  await expect(row).toContainText('Đang hiện');
  await expect(booking).toHaveText('Bật');
});
