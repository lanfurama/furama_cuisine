import { HOME_PATH } from './paths';
import { expect, test } from './staff-fixtures';

/*
 * Phase 5's guard on the guest side (spec §11): the privacy policy page and
 * the footer link to it. The footer link is hidden from the visual specs by
 * e2e/visual-added.css, so this spec is what checks it.
 */

test.use({ reducedMotion: 'reduce' });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
});

test('the privacy policy page, from the footer', async ({ page }) => {
  await page.goto(HOME_PATH);
  await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy policy' }).click();
  await expect(page).toHaveURL(/\/en\/privacy$/);
  await expect(page).toHaveTitle('Privacy policy — Furama Cuisine');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy policy');
  await expect(page.getByText('Last updated 2 October 2026')).toBeVisible();
  // Scoped to main: the chrome's booking bar has a heading of its own on every guest page.
  await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveText([
    'What we collect',
    'How we use it',
    'Who sees it',
    'How long we keep it',
    'Your rights',
  ]);
  await expect(page.getByRole('main').getByRole('link', { name: 'fb@furamavietnam.com' })).toHaveAttribute('href', 'mailto:fb@furamavietnam.com');
});
