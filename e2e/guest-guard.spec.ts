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

/**
 * Runs in the page: the contrast ratio (WCAG) of a header item's text against
 * what shows behind it, the header's own background laid over the page's. 1
 * means the item cannot be seen at all; body text needs 4.5.
 */
function contrastInHeader(el: Element): number {
  const header = el.closest('header');
  if (!header) throw new Error('not inside a header');
  const rgba = (css: string) => {
    const [r, g, b, a = 1] = (css.match(/[\d.]+/g) ?? []).map(Number);
    return { rgb: [r, g, b], a };
  };
  const page = rgba(getComputedStyle(document.body).backgroundColor);
  const bar = rgba(getComputedStyle(header).backgroundColor);
  const behind = bar.rgb.map((c, i) => c * bar.a + page.rgb[i] * (1 - bar.a));
  const luminance = (rgb: number[]) => {
    const [r, g, b] = rgb.map((c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [text, back] = [luminance(rgba(getComputedStyle(el).color).rgb), luminance(behind)];
  return (Math.max(text, back) + 0.05) / (Math.min(text, back) + 0.05);
}

const LOGO = /^FURAMA\s*CUISINE$/;
const CLEAR = 'rgba(20, 32, 28, 0)';

/*
 * The policy page has no dark hero behind the header: the cream page is there,
 * the colour of the header's own text. So the header is solid from the top on
 * that page (styles/layout.css, view 'other'), from the server HTML on, while
 * the home page keeps its clear header over the hero until it scrolls.
 */
test('the policy page’s header is solid from its first paint, on desktop and on a phone; the home page’s is still clear at the top', async ({ browser, page }) => {
  for (const viewport of [{ width: 1280, height: 860 }, { width: 390, height: 844 }]) {
    // The server HTML alone, before any script runs: :has() on the page's <main> decides.
    const context = await browser.newContext({ javaScriptEnabled: false, viewport });
    try {
      const html = await context.newPage();
      await html.goto(`${HOME_PATH}/privacy`);
      await expect.poll(() => html.getByRole('banner').getByRole('link', { name: LOGO }).evaluate(contrastInHeader)).toBeGreaterThan(4.5);
    } finally {
      await context.close();
    }

    // Hydrated: html[data-view] decides.
    await page.setViewportSize(viewport);
    await page.goto(`${HOME_PATH}/privacy`);
    await expect(page.locator('html')).toHaveAttribute('data-view', 'other');
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect.poll(() => page.getByRole('banner').getByRole('link', { name: LOGO }).evaluate(contrastInHeader)).toBeGreaterThan(4.5);

    await page.goto(HOME_PATH);
    await expect(page.locator('html')).toHaveAttribute('data-view', 'home');
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page.getByRole('banner')).toHaveCSS('background-color', CLEAR);
  }
  // The desktop header's navigation reads too, not only the logo.
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto(`${HOME_PATH}/privacy`);
  await expect.poll(() => page.getByRole('banner').getByRole('button', { name: 'RESTAURANTS' }).evaluate(contrastInHeader)).toBeGreaterThan(4.5);
  await expect.poll(() => page.getByRole('banner').getByRole('button', { name: 'SEARCH' }).evaluate(contrastInHeader)).toBeGreaterThan(4.5);
});

test('reached from the footer without a page load, the policy page’s header is solid at the top; back home it is clear again', async ({ page }) => {
  await page.goto(HOME_PATH);
  await page.evaluate(() => Reflect.set(window, 'samePage', true));
  await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy policy' }).click();
  await expect(page).toHaveURL(/\/en\/privacy$/);
  await expect(page.locator('html')).toHaveAttribute('data-view', 'other');
  // A client-side navigation: the window from before the click is still the one showing.
  expect(await page.evaluate(() => Reflect.get(window, 'samePage'))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const logo = page.getByRole('banner').getByRole('link', { name: LOGO });
  await expect.poll(() => logo.evaluate(contrastInHeader)).toBeGreaterThan(4.5);

  await logo.click();
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.locator('html')).toHaveAttribute('data-view', 'home');
  expect(await page.evaluate(() => Reflect.get(window, 'samePage'))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByRole('banner')).toHaveCSS('background-color', CLEAR);
});

test('the policy page sets its date line small, and a shared link previews the policy, not the home page', async ({ page }) => {
  await page.goto(`${HOME_PATH}/privacy`);
  const updated = page.getByText('Last updated 2 October 2026');
  await expect(updated).toHaveCSS('font-size', '12px');
  await expect(updated).toHaveCSS('margin-top', '12px');
  await expect(updated).toHaveCSS('margin-bottom', '32px');
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Privacy policy — Furama Cuisine');
  const description = await page.locator('meta[name="description"]').getAttribute('content');
  expect(description).toMatch(/^Furama Cuisine is the dining brand/);
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', description!);
});
