import type { Page } from '@playwright/test';
import { GROUP_PHONE, mockAvailability } from './availability-mock';
import { HOME_PATH } from './paths';
import { newReference } from './reservation-fixtures';
import { expect, one, test } from './staff-fixtures';

/*
 * Phase 5's guard on the guest form (spec §10.2 steps 1 and 5, §11): the
 * privacy notice, the consent box and the policy page; the honeypot; the
 * per-phone limit's message. The footer link to the policy is hidden from the
 * visual specs by e2e/visual-added.css, so this spec is what checks it.
 * Pho Cuon's last open day (today + 13) is this spec's own: no other spec
 * books there.
 */

const CONSENT = 'I agree to Furama Cuisine using my details as described in the privacy policy.';
/* 10:00 on Friday 2 Oct in Da Nang. */
const NOW = new Date('2026-10-02T03:00:00Z');

test.use({ reducedMotion: 'reduce' });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
});

/** The drawer on mocked availability, a slot chosen and the details typed in. */
async function filledDrawer(page: Page, phone = '0905 000 000') {
  await page.clock.setFixedTime(NOW);
  await mockAvailability(page, { today: () => '2026-10-02', now: () => NOW.toISOString() });
  await page.goto(HOME_PATH);
  await page.getByRole('button', { name: 'RESERVE', exact: true }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.daystrip .day')).toHaveCount(14);
  await drawer.locator('.daystrip .day[data-state="open"]').nth(3).click();
  await drawer.locator('.slot:not([disabled])').first().click();
  await drawer.getByLabel('Full name *', { exact: true }).fill('Nguyễn Minh Anh');
  await drawer.getByLabel('Phone *', { exact: true }).fill(phone);
  return drawer;
}

/** Server Action POSTs the page sends from now on. */
function actionPosts(page: Page) {
  const posts: { headers: Record<string, string> }[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.headers()['next-action']) posts.push({ headers: r.headers() });
  });
  return posts;
}

test('nothing is sent until the consent box is ticked; the notice links the policy in a new tab', async ({ page }) => {
  const drawer = await filledDrawer(page);
  const posts = actionPosts(page);
  const box = drawer.getByRole('checkbox', { name: CONSENT });
  await expect(box).not.toBeChecked();
  await expect(box).toHaveAccessibleDescription(/only to arrange this booking/);

  await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();
  await expect(drawer.getByText('Please tick the box to agree to how we use your details.')).toBeVisible();
  await expect(box).toHaveAttribute('aria-invalid', 'true');
  // The box's description carries the error, so a screen reader says what is wrong, not only "invalid".
  await expect(box).toHaveAccessibleDescription(/only to arrange this booking.*Please tick the box to agree to how we use your details\.$/);
  expect(posts).toHaveLength(0);

  await box.check();
  await expect(drawer.getByText('Please tick the box to agree to how we use your details.')).toHaveCount(0);
  await expect(box).not.toHaveAccessibleDescription(/Please tick the box/);
  await expect(box).toHaveAccessibleDescription(/only to arrange this booking/);

  const link = drawer.getByRole('link', { name: 'Privacy policy' });
  await expect(link).toHaveAttribute('href', '/en/privacy');
  const [policy] = await Promise.all([page.waitForEvent('popup'), link.click()]);
  await expect(policy.getByRole('heading', { level: 1 })).toHaveText('Privacy policy');
  // The form keeps what was typed: the policy opened beside it.
  await expect(drawer.getByLabel('Full name *', { exact: true })).toHaveValue('Nguyễn Minh Anh');
  await expect(box).toBeChecked();
});

test('the honeypot is invisible to people and screen readers, out of the tab order, and a filled one is refused', async ({ page }) => {
  const digits = String(Date.now()).slice(-6);
  const phone = `0905 ${digits.slice(0, 3)} ${digits.slice(3)}`;
  const drawer = await filledDrawer(page, phone);
  await drawer.getByRole('checkbox', { name: CONSENT }).check();

  // Not in the accessibility tree, not on screen, not reached by Tab.
  await expect(drawer.getByRole('textbox', { name: 'Website' })).toHaveCount(0);
  expect(await drawer.ariaSnapshot()).not.toContain('Website');
  const trap = drawer.locator('input[name="website"]');
  await expect(trap).not.toBeInViewport();
  await drawer.getByLabel('Special requests', { exact: true }).focus();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name)).not.toBe('website');
  await expect(drawer.getByRole('link', { name: 'Privacy policy' })).toBeFocused();

  // A script that fills every field it finds.
  const posts = actionPosts(page);
  await trap.fill('https://spam.example', { force: true });
  await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();
  // Never a fake success (R15): the guest is told, with the restaurant's number to call.
  await expect(drawer.getByRole('alert')).toHaveText(`We could not accept this request online. Please call us on ${GROUP_PHONE.display} to book.`);
  expect(posts).toHaveLength(1);
  expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM reservations WHERE phone_e164 = $1`, [`+84905${digits}`]))!.n).toBe(0);
});

test('a fourth request for one day from one number gets the limit and the restaurant’s own number to call', async ({ page }) => {
  // Pho Cuon (Dining House) on its last open day: three active web requests for one number are already in.
  const digits = String(Date.now()).slice(-6);
  const phone = `0906 ${digits.slice(0, 3)} ${digits.slice(3)}`;
  const e164 = `+84906${digits}`;
  const date = (await one<{ d: string }>(`SELECT to_char((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + 13, 'YYYY-MM-DD') AS d`))!.d;
  for (const [i, time] of ['18:00', '18:30', '20:00'].entries()) {
    await one(
      `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source, status, consent_version, consented_at)
       VALUES ($1, 'pho-cuon', $2::date, $3, 'Dinner', 2, 'Khách E2E', $4, $5, 'web', $6, '2026-10-02', now())`,
      [newReference(), date, time, phone, e164, i === 0 ? 'confirmed' : 'requested'],
    );
  }
  await page.goto(HOME_PATH);
  await page.locator('.rcard:visible', { hasText: 'Phố Cuốn' }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.daystrip .day')).toHaveCount(14);
  await drawer.locator('.daystrip .day[data-state="open"]').last().click();
  await drawer.locator('.slot:not([disabled])').last().click();
  await drawer.getByLabel('Full name *', { exact: true }).fill('Khách Thứ Tư');
  await drawer.getByLabel('Phone *', { exact: true }).fill(phone);
  await drawer.getByRole('checkbox', { name: CONSENT }).check();
  await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();
  await expect(drawer.getByRole('alert')).toHaveText(
    'This number already has 3 table requests for that day. To book more, please call us on 0859 555 759.',
  );
  expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM reservations WHERE phone_e164 = $1`, [e164]))!.n).toBe(3);
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
