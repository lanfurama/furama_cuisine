import type { Browser, Page } from '@playwright/test';
import { STRING_KEYS } from '../lib/i18n/registry';
import { expectHydrated } from './csp';
import { STAFF, db, expect, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * Phase 9, part 1 (spec §9.3, R9-8): "Dịch từ EN" fills a language tab (and a
 * strings-screen key) from the English text, through the fake model
 * (AI_PROVIDER=fake, playwright.config.ts: «vi» + the text). Nothing is saved
 * until staff press Lưu; then the row is 'reviewed' like any typed text.
 *
 * Part 2 (D8, R9-16 … R9-20, R9-24): an Admin translates everything missing
 * in Vietnamese with one bulk job; the machine rows wait in the review queue,
 * guests keep reading English until "Duyệt"; a paused job goes on with
 * "Tiếp tục"; an Editor watches but cannot start one.
 *
 * Serial (desktop-serial): it writes Vietnamese rows every guest page may
 * read (Vietnamese is on in lib/i18n/site-locales.ts), and deletes every
 * Vietnamese row, job and AI usage row it made at the end.
 */

/** Every guest email key as a reviewed Vietnamese row (the phase-8 fixture: the gate asks for a row, not good Vietnamese). */
const GUEST_EMAIL_KEYS = STRING_KEYS.filter((k) => k.startsWith('email.') && !k.startsWith('email.staff.') && k !== 'email.common.footer_staff');

async function guest(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  return context.newPage();
}

const I18N = ['offer_i18n', 'cuisine_i18n', 'destination_i18n', 'experience_i18n', 'story_i18n', 'nav_item_i18n', 'restaurant_i18n', 'restaurant_highlight_i18n', 'media_i18n'];

async function cleanUp() {
  const c = db();
  await c.connect();
  try {
    for (const t of I18N) await c.query(`DELETE FROM ${t} WHERE locale = 'vi'`);
    await c.query(`DELETE FROM content_strings WHERE locale = 'vi'`);
    await c.query('TRUNCATE ai_jobs, ai_usage CASCADE');
    await c.query(`DELETE FROM audit_log WHERE entity_type = 'ai_jobs' OR after->'meta' ? 'machine'`);
  } finally {
    await c.end();
  }
}

test.beforeAll(async () => {
  await seedStaff();
  await cleanUp();
  const c = db();
  await c.connect();
  try {
    for (const key of GUEST_EMAIL_KEYS) {
      await c.query(`INSERT INTO content_strings (key, locale, value, status, origin) VALUES ($1, 'vi', 'x', 'reviewed', 'human') ON CONFLICT DO NOTHING`, [key]);
    }
  } finally {
    await c.end();
  }
});
test.afterAll(cleanUp);

test('an Editor translates an offer title from English, saves it, and /vi shows it as reviewed', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signInAs(page, STAFF.editor);
  await page.goto('/admin/content/offers/2');
  await expectHydrated(page);
  const english = await page.getByLabel('Tiêu đề', { exact: true }).inputValue();
  await page.getByRole('tablist', { name: 'Tiêu đề: ngôn ngữ' }).getByRole('tab', { name: /VI/ }).click();
  const viTitle = page.getByLabel('Tiêu đề (VI)');
  await expect(viTitle).toHaveValue('');
  await page.locator('[role="tabpanel"]:not([hidden])').getByRole('button', { name: 'Dịch từ EN' }).first().click();
  await expect(viTitle).toHaveValue(`«vi» ${english}`);

  // Filled like typing: the form is unsaved now (the leave-page guard is on).
  const prevented = await page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(prevented).toBe(true);

  await page.getByRole('button', { name: 'Lưu' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Đã lưu' })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Tiêu đề: ngôn ngữ' }).getByRole('tab', { name: /VI/ })).toContainText('Đã duyệt');

  const visitor = await guest(browser);
  try {
    await expect
      .poll(async () => {
        await visitor.goto('/vi');
        return visitor.locator('#offers .offer-title').allTextContents();
      }, { timeout: 15_000 })
      .toContain(`«vi» ${english}`);
  } finally {
    await visitor.context().close();
  }
});

test('on the strings screen, "Dịch từ EN" keeps {max} and {phone}', async ({ page }) => {
  await signInAs(page, STAFF.editor);
  await page.goto('/admin/content/ui-text?lang=vi');
  await expectHydrated(page);
  const key = page.locator('[data-key="error.party_too_large"]');
  await key.getByRole('button', { name: 'Dịch từ EN' }).click();
  const box = key.locator('[name="v:error.party_too_large"]');
  await expect(box).toHaveValue('«vi» For more than {max} guests, please call us on {phone}.');
  // The English screen has no such button.
  await page.goto('/admin/content/ui-text');
  await expect(page.getByRole('button', { name: 'Dịch từ EN' })).toHaveCount(0);
});

test('the translate route refuses a caller without a session', async ({ request }) => {
  const res = await request.post('/api/admin/ai/translate', { data: { locale: 'vi', items: [{ id: 'x', text: 'Hello' }] } });
  expect([401, 403]).toContain(res.status());
});

/** The job row of a language on /admin/translations. */
const jobRow = (page: Page) => page.getByTestId('ai-job').filter({ hasText: '(VI)' });

async function sql<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const c = db();
  await c.connect();
  try {
    return (await c.query(text, values)).rows as T[];
  } finally {
    await c.end();
  }
}

test('an Admin translates what is missing with one job; guests see a machine title only once it is reviewed', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const [{ title: english }] = await sql<{ title: string }>(`SELECT title FROM offer_i18n WHERE offer_id = 1 AND locale = 'en'`);
  await signInAs(page, STAFF.admin);
  await page.goto('/admin/translations');
  await expectHydrated(page);
  const panel = page.getByRole('region', { name: 'Dịch hàng loạt bằng AI' });
  await expect(panel.getByText(/Còn thiếu \d+ mục\./)).toBeVisible();
  await panel.getByLabel('Ngôn ngữ').selectOption('vi');
  await panel.getByRole('button', { name: 'Dịch tất cả phần còn thiếu bằng AI' }).click();
  // The outcome is the admin's success notice, not an error line.
  await expect(panel.locator('.a-notice')).toHaveText(/^Đã bắt đầu dịch/);
  // The panel polls every 5 seconds and refreshes the page when the status changes.
  await expect(jobRow(page).getByText('Xong', { exact: true })).toBeVisible({ timeout: 120_000 });
  expect(await sql(`SELECT DISTINCT status, origin FROM offer_i18n WHERE locale = 'vi' AND offer_id <> 2`)).toEqual([{ status: 'machine', origin: 'ai' }]);

  // The machine rows wait in the queue.
  await page.goto('/admin/translations?locale=vi&kind=offers#queue');
  const queue = page.getByRole('form', { name: 'Hàng chờ duyệt' });
  await expect(queue.getByRole('row').filter({ hasText: `«vi» ${english}` }).getByText('Máy dịch')).toBeVisible();

  const visitor = await guest(browser);
  try {
    // Guests read reviewed translations only: offer 1 is still English on /vi.
    await visitor.goto('/vi');
    await expect(visitor.locator('#offers .offer-title').filter({ hasText: english }).first()).toBeVisible();
    expect(await visitor.locator('#offers .offer-title').allTextContents()).not.toContain(`«vi» ${english}`);

    await queue.getByRole('button', { name: 'Duyệt: Ưu đãi 1 (VI)' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Đã duyệt.' })).toBeVisible();
    await expect
      .poll(async () => {
        await visitor.goto('/vi');
        return visitor.locator('#offers .offer-title').allTextContents();
      }, { timeout: 15_000 })
      .toContain(`«vi» ${english}`);
  } finally {
    await visitor.context().close();
  }
});

test('a paused job shows its Vietnamese error, and "Tiếp tục" runs it to the end', async ({ page }) => {
  test.setTimeout(120_000);
  // A job that stopped on Vertex's quota (the integration tests pause a real run; here the screen is under test).
  await sql(`DELETE FROM offer_i18n WHERE locale = 'vi' AND offer_id = 3`);
  await sql(`INSERT INTO ai_jobs (locale, status, error, progress, created_by) VALUES ('vi', 'paused', 'ai_quota', '{"done":6,"failed":0,"remaining":1}', $1)`, [
    STAFF.admin.id,
  ]);
  await signInAs(page, STAFF.admin);
  await page.goto('/admin/translations');
  await expectHydrated(page);
  const row = jobRow(page);
  await expect(row.getByText('Tạm dừng', { exact: true })).toBeVisible();
  await expect(row.getByText('Hết quota Vertex.')).toBeVisible();
  await expect(row).toContainText('Đã dịch 6, còn 1, lỗi 0');
  await row.getByRole('button', { name: 'Tiếp tục' }).click();
  await expect(row.getByText('Xong', { exact: true })).toBeVisible({ timeout: 60_000 });
  expect(await sql(`SELECT status, origin FROM offer_i18n WHERE locale = 'vi' AND offer_id = 3`)).toEqual([{ status: 'machine', origin: 'ai' }]);
});

test('an Editor watches the jobs but cannot start, resume or cancel one, not even through the route', async ({ page }) => {
  await sql(`INSERT INTO ai_jobs (locale, status, error) VALUES ('vi', 'paused', 'ai_budget')`);
  await signInAs(page, STAFF.editor);
  await page.goto('/admin/translations');
  await expectHydrated(page);
  const panel = page.getByRole('region', { name: 'Dịch hàng loạt bằng AI' });
  await expect(panel.getByText('Chỉ Admin chạy được dịch hàng loạt.')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Dịch tất cả phần còn thiếu bằng AI' })).toHaveCount(0);
  await expect(panel.getByTestId('ai-job').first()).toBeVisible();
  await expect(panel.getByRole('button', { name: /Hủy|Tiếp tục|Chạy tiếp ngay/ })).toHaveCount(0);
  const origin = new URL(page.url()).origin;
  expect((await page.request.post('/api/admin/ai/jobs', { data: { locale: 'vi' }, headers: { origin } })).status()).toBe(403);
  const id = ((await (await page.request.get('/api/admin/ai/jobs')).json()) as { jobs: { id: string }[] }).jobs[0].id;
  for (const action of ['resume', 'cancel']) {
    expect((await page.request.post(`/api/admin/ai/jobs/${id}`, { data: { action }, headers: { origin } })).status()).toBe(403);
  }
});
