import { expect, test } from '@playwright/test';
import { PAGES } from './paths';

/**
 * The same pages with JavaScript off: what a crawler or a visitor without JS
 * gets from the server HTML alone. The hero slides are masked because their
 * CSS crossfade is not frozen without the page's scripts.
 */
test.use({ javaScriptEnabled: false, reducedMotion: 'reduce' });

for (const [name, path] of Object.entries(PAGES)) {
  test(`@visual no-JS ${name}`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot(`nojs-${name}.png`, {
      fullPage: true,
      mask: [page.locator('.hero-slides')],
    });
  });
}
