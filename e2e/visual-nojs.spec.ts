import { expect, test } from '@playwright/test';
import { PAGES } from './paths';

/**
 * The same pages with JavaScript off: what a crawler or a visitor without JS
 * gets from the server HTML alone. The hero slides are masked because their
 * CSS crossfade is not frozen without the page's scripts.
 *
 * Content images come from next/image's optimiser since phase 7 (R3). Without
 * scripting the browser loads every image at once (the HTML spec turns lazy
 * loading off), but a cold /_next/image may still be encoding one when the
 * network goes quiet, so the shot waits until each has decoded, as visual.spec
 * does (R19, C4). The wait polls from the test: the page's own timers and
 * animation frames do not run while its scripts are off.
 */
test.use({ javaScriptEnabled: false, reducedMotion: 'reduce' });

for (const [name, path] of Object.entries(PAGES)) {
  test(`@visual no-JS ${name}`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'networkidle' });
    await expect
      .poll(() => page.evaluate(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0)), { timeout: 30_000 })
      .toBe(true);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot(`nojs-${name}.png`, {
      fullPage: true,
      mask: [page.locator('.hero-slides')],
      stylePath: './e2e/visual-added.css',
    });
  });
}
