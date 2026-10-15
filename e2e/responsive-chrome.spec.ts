import { expect, test, type Page } from '@playwright/test';
import { DETAIL_PATH, HOME_PATH } from './paths';

/*
 * The chrome every guest page shares (styles/layout.css, tokens.css, fx.css,
 * dropdown.css; components/ui/Dropdown.tsx). On a phone on its side the fixed
 * header and tab bar took 41% of the screen and hid the hero's headline. From
 * 1080 to about 1190px the roomy header ran 48px into the right gutter. A
 * dropdown near the screen's foot opened its list off screen. Keyboard focus
 * filled RESERVE and EXPLORE OUR RESTAURANTS and left their labels the colour
 * of the fill. A closed day's reason was a tooltip, which no phone shows. The
 * footer's tagline ran off a 320px phone.
 */

test.use({ reducedMotion: 'reduce' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
});

/** The share of the screen's height the visible fixed header and tab bar take, and the bar's height. */
function fixedBars(page: Page) {
  return page.evaluate(() => {
    const shown = (el: Element) => el.getClientRects().length > 0;
    const header = [...document.querySelectorAll('header.hdr')].find(shown);
    const tabbar = [...document.querySelectorAll('nav.tabbar')].find(shown);
    const h = (el: Element | undefined) => (el ? el.getBoundingClientRect().height : 0);
    return { share: (h(header) + h(tabbar)) / innerHeight, header: h(header), tabbar: h(tabbar) };
  });
}

for (const { width, height } of [
  { width: 568, height: 320 },
  { width: 750, height: 342 },
]) {
  test.describe(`a phone on its side (${width} × ${height})`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true });

    test('the home page has a slim header with RESERVE and no tab bar', async ({ page }) => {
      await page.goto(HOME_PATH);
      await expect(page.locator('.hdr-compact .hdr-compact-reserve')).toBeVisible();
      await expect(page.locator('.tabbar-home')).toBeHidden();
      const bars = await fixedBars(page);
      expect(bars.header).toBe(52);
      expect(bars.share).toBeLessThanOrEqual(0.2);
      // Nothing left to clear at the page's foot.
      expect(await page.locator('.footer-bottom-space').evaluate((el) => el.getBoundingClientRect().height)).toBe(0);
    });

    test('a restaurant page keeps its tab bar, slimmer, and the footer clears it', async ({ page }) => {
      await page.goto(DETAIL_PATH);
      await expect(page.locator('.tabbar-detail')).toBeVisible();
      const bars = await fixedBars(page);
      expect(bars.tabbar).toBe(52);
      expect(bars.share).toBeLessThanOrEqual(0.2);
      expect(await page.locator('.footer-bottom-space').evaluate((el) => el.getBoundingClientRect().height)).toBe(52);
    });
  });
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });

  test('the tab bar keeps its height, the footer clears it, and the tagline stays on screen', async ({ page }) => {
    await page.goto(HOME_PATH);
    expect((await fixedBars(page)).tabbar).toBe(76);
    expect(await page.locator('.footer-bottom-space').evaluate((el) => el.getBoundingClientRect().height)).toBe(76);
    const tagline = await page.locator('.footer-tagline').evaluate((el) => el.getBoundingClientRect().right);
    expect(tagline).toBeLessThanOrEqual(320);
  });

  test('a page without a tab bar leaves no gap under its footer', async ({ page }) => {
    await page.goto('/en/privacy');
    await expect(page.locator('main[data-view="other"]')).toBeVisible();
    expect(await page.locator('.footer-bottom-space').evaluate((el) => el.getBoundingClientRect().height)).toBe(0);
  });
});

for (const { width, height } of [
  { width: 1080, height: 700 },
  { width: 1194, height: 834 },
]) {
  test(`at ${width} × ${height} the roomy header stays inside its gutter, the nav apart from SEARCH`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(HOME_PATH);
    await expect(page.locator('.hdr-full')).toBeVisible();
    const r = await page.locator('.hdr-full .hdr-inner').evaluate((inner) => {
      const edge = inner.getBoundingClientRect().right - parseFloat(getComputedStyle(inner).paddingRight);
      const links = [...inner.querySelectorAll('.hdr-nav .hdr-link')].map((l) => l.getBoundingClientRect());
      const actions = inner.querySelector('.hdr-actions')!.getBoundingClientRect();
      return { edge, actionsRight: actions.right, toSearch: actions.left - links[links.length - 1].right, between: links[1].left - links[0].right };
    });
    expect(r.actionsRight).toBeLessThanOrEqual(r.edge + 1);
    expect(r.toSearch).toBeGreaterThan(r.between);
  });
}

/** Scrolls the booking bar's `n`th field to the screen's foot (above a tab bar), opens it and returns its list's box. */
async function openAtFoot(page: Page, n: number) {
  const field = page.locator('.booking .dd').nth(n);
  await field.evaluate((el) => el.scrollIntoView({ block: 'end' }));
  await field.locator('.dd-trigger').click();
  return page.locator('.booking .dd-panel').evaluate((el) => {
    const b = el.getBoundingClientRect();
    const tabbar = [...document.querySelectorAll('nav.tabbar')].find((t) => t.getClientRects().length > 0);
    return { top: b.top, bottom: b.bottom, floor: tabbar ? tabbar.getBoundingClientRect().top : innerHeight };
  });
}

for (const { width, height, touch } of [
  { width: 1280, height: 720, touch: false },
  { width: 390, height: 664, touch: true },
  { width: 750, height: 342, touch: true },
]) {
  test.describe(`a dropdown at the screen's foot (${width} × ${height})`, () => {
    test.use({ viewport: { width, height }, isMobile: touch, hasTouch: touch });

    test('opens its list on screen, above the field', async ({ page }) => {
      await page.goto(HOME_PATH);
      const list = await openAtFoot(page, 4);
      expect(list.top).toBeGreaterThanOrEqual(0);
      expect(list.bottom).toBeLessThanOrEqual(list.floor);
      await expect(page.locator('.booking .dd-panel')).toHaveAttribute('data-side', 'above');
    });
  });
}

test('keyboard focus fills a button and turns its label with it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto(HOME_PATH);
  const reserve = page.locator('.hdr-full .btn-gold');
  const explore = page.locator('.hero-explore');
  await expect(explore).toBeVisible();
  // Tab until the header's RESERVE, then on to EXPLORE OUR RESTAURANTS.
  for (const [button, ink] of [
    [reserve, 'rgb(247, 242, 232)'],
    [explore, 'rgb(247, 242, 232)'],
  ] as const) {
    for (let i = 0; i < 40 && !(await button.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
    await expect(button).toBeFocused();
    await expect(button).toHaveCSS('color', ink);
  }
});

test.describe("a closed day's reason", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('shows under the day in the date list, where a phone can read it', async ({ page }) => {
    await page.route('**/api/availability**', async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      if (Array.isArray(json.days) && json.days[2]) Object.assign(json.days[2], { state: 'closed', reason: 'Closed for a private event' });
      await route.fulfill({ response, json });
    });
    await page.goto(HOME_PATH);
    const field = page.locator('.booking .dd').nth(2);
    await field.scrollIntoViewIfNeeded();
    await field.locator('.dd-trigger').click();
    const closed = page.getByRole('listbox', { name: 'Date' }).getByRole('option').nth(2);
    await expect(closed).toHaveAttribute('aria-disabled', 'true');
    await expect(closed.locator('.dd-hint')).toHaveText('Closed for a private event');
    // The accessible name stays the day and its note; the reason is its description (title).
    await expect(closed).toHaveAttribute('title', 'Closed for a private event');
  });
});
