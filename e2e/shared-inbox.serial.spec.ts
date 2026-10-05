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

test('saving the shared inbox changes the footer and the privacy policy within seconds', async ({ page, browser }) => {
  const visitor = await guest(browser);
  try {
    await visitor.goto(HOME_PATH);
    await expect(visitor.locator('footer a[href^="mailto:"]')).toHaveText(SEED);

    await signInAs(page, STAFF.admin);
    try {
      await saveInbox(page, NEW);

      // Within seconds, as every content save (AC1): a page render that started before the save may still
      // be stored once (plan 7B task B11 saw it once, after the checklist walk), so the guest reloads.
      await expect
        .poll(
          async () => {
            await visitor.reload();
            return visitor.locator('footer a[href^="mailto:"]').textContent();
          },
          { timeout: 5_000 },
        )
        .toBe(NEW);
      await expect(visitor.locator('footer a[href^="mailto:"]')).toHaveAttribute('href', `mailto:${NEW}`);
      await visitor.goto('/en/privacy');
      await expect(visitor.locator('article.legal a[href^="mailto:"]').first()).toHaveText(NEW);
    } finally {
      await saveInbox(page, SEED);
    }
    /*
     * Both pages re-rendered above with the new address, and the tag's expiry lives in the server's
     * memory: a restarted server would serve those files as they are on disk. Visiting each page
     * again writes it back with the seeded address.
     */
    await visitor.goto(HOME_PATH);
    await expect(visitor.locator('footer a[href^="mailto:"]')).toHaveText(SEED);
    await visitor.goto('/en/privacy');
    const policy = visitor.getByRole('article');
    await expect(policy.getByRole('link', { name: SEED, exact: true }).first()).toHaveAttribute('href', `mailto:${SEED}`);
    await expect(policy.getByRole('link', { name: NEW, exact: true })).toHaveCount(0);
  } finally {
    await visitor.context().close();
  }
});
