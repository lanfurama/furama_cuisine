import type { Browser, Page } from '@playwright/test';
import { expectHydrated, watchCsp } from './csp';
import { STAFF, db, expect, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * Phase 9 D10 (spec §9.3, R9-22): "Gợi ý bằng AI" for SEO, through the fake
 * model (AI_PROVIDER=fake, playwright.config.ts: «vi» + the page's first name
 * + a description too long for search results, which the server cuts to 155).
 * The home page's pair on the SEO screen, a restaurant's pair on its own form
 * (with its own language choice): the boxes are filled like typing, nothing
 * is saved until Lưu, and then guests' <title> and meta description follow.
 *
 * Serial (desktop-serial): it writes Vietnamese rows the guest pages read,
 * and deletes them, and the AI usage rows, at the end.
 */

async function sql<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const c = db();
  await c.connect();
  try {
    return (await c.query(text, values)).rows as T[];
  } finally {
    await c.end();
  }
}

async function cleanUp() {
  await sql(`DELETE FROM content_strings WHERE locale = 'vi' AND key IN ('seo.home_title', 'seo.home_description')`);
  await sql(`DELETE FROM restaurant_i18n WHERE locale = 'vi' AND restaurant_id = 'taya-house'`);
  await sql('TRUNCATE ai_usage');
}

async function guest(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  return context.newPage();
}

/** A guest page's tab title and meta description, freshly loaded. */
async function head(visitor: Page, path: string): Promise<{ title: string; description: string | null }> {
  await visitor.goto(path);
  return visitor.evaluate(() => ({ title: document.title, description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? null }));
}

const unsaved = (page: Page) =>
  page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });

test.beforeAll(async () => {
  await seedStaff();
  await cleanUp();
});
test.afterAll(cleanUp);

test('an Editor has the home page’s Vietnamese title and description suggested, saves them, and /vi shows them', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const csp = await watchCsp(page);
  await signInAs(page, STAFF.editor);
  await page.goto('/admin/content/seo?lang=vi');
  await expectHydrated(page);
  const form = page.getByRole('form', { name: 'Chữ SEO' });
  const title = form.locator('[name="v:seo.home_title"]');
  const description = form.locator('[name="v:seo.home_description"]');
  await expect(title).toHaveValue('');

  // One button, by the home page's pair: the share text and the title patterns get none.
  await expect(form.getByRole('button', { name: 'Gợi ý bằng AI' })).toHaveCount(1);
  await form.getByRole('button', { name: 'Gợi ý bằng AI' }).click();
  await expect(form.getByText('Đã điền tiêu đề và mô tả. Xem lại rồi bấm Lưu.')).toBeVisible();
  const suggested = { title: await title.inputValue(), description: await description.inputValue() };
  expect(suggested.title).toMatch(/^«vi» .+ — fake SEO title$/);
  expect([...suggested.title].length).toBeLessThanOrEqual(60);
  expect(suggested.description).toMatch(/^«vi» A fake description of this page/);
  expect([...suggested.description].length).toBeLessThanOrEqual(155);
  // Filled like typing and not saved: the leave-page guard is on, the database has no row yet.
  expect(await unsaved(page)).toBe(true);
  expect(await sql(`SELECT 1 FROM content_strings WHERE locale = 'vi' AND key = 'seo.home_title'`)).toEqual([]);

  await form.getByRole('button', { name: 'Lưu chữ seo' }).click();
  await expect(form.getByRole('status').filter({ hasText: 'Đã lưu' })).toBeVisible();
  expect(await sql(`SELECT key, value, status FROM content_strings WHERE locale = 'vi' AND key IN ('seo.home_title', 'seo.home_description') ORDER BY key`)).toEqual([
    { key: 'seo.home_description', value: suggested.description, status: 'reviewed' },
    { key: 'seo.home_title', value: suggested.title, status: 'reviewed' },
  ]);

  const visitor = await guest(browser);
  try {
    await expect.poll(async () => head(visitor, '/vi'), { timeout: 15_000 }).toEqual(suggested);
  } finally {
    await visitor.context().close();
  }
  expect(await sql(`SELECT feature, actor_id, status FROM ai_usage`)).toEqual([{ feature: 'seo', actor_id: STAFF.editor.id, status: 'ok' }]);
  expect(csp).toEqual([]);
});

test('an Admin has Tàya House’s Vietnamese SEO suggested from its own language choice, saves it, and its /vi page shows it', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const csp = await watchCsp(page);
  await signInAs(page, STAFF.admin);
  await page.goto('/admin/restaurants/taya-house');
  await expectHydrated(page);
  const form = page.getByRole('form', { name: 'Nội dung nhà hàng' });
  const englishTitle = await form.getByLabel('Tiêu đề SEO', { exact: true }).inputValue();

  await form.getByLabel('Ngôn ngữ gợi ý SEO').selectOption('vi');
  await form.getByRole('button', { name: 'Gợi ý bằng AI' }).click();
  await expect(form.getByText('Đã điền tab VI. Xem lại rồi bấm Lưu.')).toBeVisible();
  await form.getByRole('tablist', { name: 'Tiêu đề SEO: ngôn ngữ' }).getByRole('tab', { name: /VI/ }).click();
  await expect(form.getByLabel('Tiêu đề SEO (VI)')).toHaveValue('«vi» Tàya House — fake SEO title');
  await form.getByRole('tablist', { name: 'Mô tả SEO: ngôn ngữ' }).getByRole('tab', { name: /VI/ }).click();
  const description = await form.getByLabel('Mô tả SEO (VI)').inputValue();
  expect(description).toMatch(/^«vi» A fake description of this page/);
  expect([...description].length).toBeLessThanOrEqual(155);
  // Only the chosen language's boxes: English is as it was.
  expect(await form.getByLabel('Tiêu đề SEO', { exact: true }).inputValue()).toBe(englishTitle);
  expect(await unsaved(page)).toBe(true);
  expect(await sql(`SELECT 1 FROM restaurant_i18n WHERE locale = 'vi' AND restaurant_id = 'taya-house'`)).toEqual([]);

  await form.getByRole('button', { name: 'Lưu nhà hàng' }).click();
  await expect(form.getByRole('status').filter({ hasText: 'Đã lưu' })).toBeVisible();
  expect(await sql(`SELECT seo_title, seo_description, status FROM restaurant_i18n WHERE locale = 'vi' AND restaurant_id = 'taya-house'`)).toEqual([
    { seo_title: '«vi» Tàya House — fake SEO title', seo_description: description, status: 'reviewed' },
  ]);

  const visitor = await guest(browser);
  try {
    await expect
      .poll(async () => head(visitor, '/vi/restaurants/taya-house'), { timeout: 15_000 })
      .toEqual({ title: '«vi» Tàya House — fake SEO title', description });
  } finally {
    await visitor.context().close();
  }
  expect(csp).toEqual([]);
});

test('the SEO route refuses a caller without a session', async ({ request }) => {
  const res = await request.post('/api/admin/ai/seo', { data: { target: { kind: 'home' }, locale: 'vi' } });
  expect([401, 403]).toContain(res.status());
});
