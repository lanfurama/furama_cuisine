import { expect, test } from '@playwright/test';
import { serveImagesFromPublic } from './images';
import { DETAIL_PATH, HOME_PATH } from './paths';

/* What a visitor or a crawler without JavaScript gets: the server HTML alone. */
test.use({ javaScriptEnabled: false });

// Without JavaScript every image loads eagerly, and goto() waits for all of them.
test.beforeEach(({ page }) => serveImagesFromPublic(page));

test('the home page lists every restaurant', async ({ page }) => {
  await page.goto(HOME_PATH);
  await expect(page.locator('.rcard')).toHaveCount(12);
  const html = await (await page.request.get(HOME_PATH)).text();
  expect(html).not.toContain('hidden id="S:');
});

test('the restaurant page is in the HTML itself, not streamed in by a script', async ({ page, request }) => {
  await page.goto(DETAIL_PATH);
  await expect(page.locator('.taya-kicker')).toBeVisible();
  const html = await (await request.get(DETAIL_PATH)).text();
  expect(html).toContain('taya-kicker');
  expect(html).not.toContain('hidden id="S:');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the restaurant page swaps the header and booking bar for its own tab bar', async ({ page }) => {
    await page.goto(HOME_PATH);
    await expect(page.locator('.hdr-compact')).toBeVisible();
    await expect(page.locator('.booking-slot')).toBeVisible();

    await page.goto(DETAIL_PATH);
    await expect(page.locator('.hdr-compact')).toBeHidden();
    await expect(page.locator('.booking-slot')).toBeHidden();
    await expect(page.locator('.tabbar-detail')).toBeVisible();
  });
});
