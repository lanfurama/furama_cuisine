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
 * Serial (desktop-serial): it turns Vietnamese on for guests, and puts the
 * table back as migration 004 seeded it (en on, vi off) at the end.
 */

/** Every guest email key as a reviewed Vietnamese row (the phase-8 fixture: the gate asks for a row, not good Vietnamese). */
const GUEST_EMAIL_KEYS = STRING_KEYS.filter((k) => k.startsWith('email.') && !k.startsWith('email.staff.') && k !== 'email.common.footer_staff');

async function guest(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  return context.newPage();
}

async function cleanUp() {
  const c = db();
  await c.connect();
  try {
    await c.query(`DELETE FROM offer_i18n WHERE locale = 'vi'`);
    await c.query(`DELETE FROM content_strings WHERE locale = 'vi'`);
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
