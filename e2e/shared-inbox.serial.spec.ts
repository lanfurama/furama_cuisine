import type { Browser, Page } from '@playwright/test';
import { HOME_PATH } from './paths';
import { STAFF, expect, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * The shared inbox (site_settings.email) is also the guest site's general
 * email, in the footer and the privacy policy (phase-5 handoff, R22): saving
 * it in "Thông báo email" expires content:contact, so both show the new
 * address at once. It changes where staff.new falls back to
 * (booking-email.spec.ts), so it runs in the desktop-serial project, and it
 * puts the seeded address back through the same form (R21), which expires the
 * same tag.
 */

const SEED = 'fb@furamavietnam.com';
const NEW = 'datban@furama.test';

async function guest(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  return context.newPage();
}

async function saveInbox(page: Page, email: string) {
  await page.goto('/admin/settings/notifications');
  const form = page.getByRole('form', { name: 'Hộp thư chung' });
  await form.getByLabel('Email hộp thư chung', { exact: true }).fill(email);
  await form.getByRole('button', { name: 'Lưu hộp thư chung' }).click();
  await expect(page.getByRole('form', { name: 'Hộp thư chung' }).getByRole('status')).toHaveText('Đã lưu.');
}

test.beforeAll(() => seedStaff());

test('saving the shared inbox changes the footer and the privacy policy at once', async ({ page, browser }) => {
  const visitor = await guest(browser);
  await visitor.goto(HOME_PATH);
  await expect(visitor.locator('footer a[href^="mailto:"]')).toHaveText(SEED);

  await signInAs(page, STAFF.admin);
  try {
    await saveInbox(page, NEW);

    await visitor.reload();
    await expect(visitor.locator('footer a[href^="mailto:"]')).toHaveText(NEW);
    await expect(visitor.locator('footer a[href^="mailto:"]')).toHaveAttribute('href', `mailto:${NEW}`);
    await visitor.goto('/en/privacy');
    await expect(visitor.locator('article.legal a[href^="mailto:"]').first()).toHaveText(NEW);
  } finally {
    await saveInbox(page, SEED);
  }
  await visitor.goto(HOME_PATH);
  await expect(visitor.locator('footer a[href^="mailto:"]')).toHaveText(SEED);
  await visitor.context().close();
});
