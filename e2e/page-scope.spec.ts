import { expect, test, type Page } from '@playwright/test';
import { DETAIL_PATH, HOME_PATH } from './paths';

/*
 * Moving between the home page and a restaurant page. With Cache Components the
 * router keeps the page you left mounted but hidden (<Activity>): its DOM, its
 * ids and its data-intro-done flags stay in the document. Every case below broke
 * on that in the phase-2 spike, so each must hold with and without it.
 */
test.use({ reducedMotion: 'no-preference' });

let reactErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  reactErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /hydrat|did not match|#418|#423|#425/i.test(m.text())) reactErrors.push(m.text());
  });
  page.on('pageerror', (e) => reactErrors.push(e.message));
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
});

test.afterEach(() => {
  expect(reactErrors).toEqual([]);
});

type CurtainWindow = Window & { __curtain?: string[] };

/**
 * Records every change of the page curtain's data-active from now on. A write
 * of the value it already holds is no change: under load, the curtain's mount
 * effect can run after this observer is in place (waiting for hydration does
 * not prevent it), and must not read as a curtain that went down.
 */
async function recordCurtain(page: Page) {
  await page.evaluate(() => {
    const el = document.querySelector('.page-curtain');
    if (!el) throw new Error('no .page-curtain');
    const w = window as CurtainWindow;
    w.__curtain = [];
    new MutationObserver((records) => {
      // One callback can carry several writes: each one's new value is the next one's old value.
      records.forEach((m, i) => {
        const value = i + 1 < records.length ? records[i + 1].oldValue : el.getAttribute('data-active');
        if (m.oldValue !== value) w.__curtain?.push(value ?? '');
      });
    }).observe(el, { attributes: true, attributeFilter: ['data-active'], attributeOldValue: true });
  });
}

const curtainLog = (page: Page) => page.evaluate(() => (window as CurtainWindow).__curtain ?? []);

/** Distance from the visible copy of #id (hidden pages keep theirs) to the 75px header offset. */
const offsetFromHeader = (page: Page, id: string) =>
  page.evaluate((id) => {
    const shown = [...document.querySelectorAll<HTMLElement>(`[id="${id}"]`)].find(
      (e) => e.getClientRects().length > 0,
    );
    return shown ? Math.abs(Math.round(shown.getBoundingClientRect().top) - 75) : Infinity;
  }, id);

const tayaCard = (page: Page) => page.locator('.rcard:visible', { hasText: 'Tàya House' }).first();

async function openTaya(page: Page) {
  await tayaCard(page).click();
  await page.waitForURL((u) => u.pathname === DETAIL_PATH);
  await expect(page.locator('.taya-kicker:visible')).toHaveCSS('opacity', '1');
}

test('each page owns its <main data-view>, and the document says which page is showing', async ({ page }) => {
  await page.goto(HOME_PATH);
  await expect(page.locator('main[data-view="home"]')).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('data-view', 'home');
  await openTaya(page);
  await expect(page.locator('main[data-view="detail"]')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-view', 'detail');
});

test('a card opens the restaurant page under the curtain, at the top', async ({ page }) => {
  await page.goto(HOME_PATH);
  await recordCurtain(page);
  await openTaya(page);
  await expect.poll(() => curtainLog(page)).toEqual(['true', 'false']);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('the header on a restaurant page goes home and scrolls to the section', async ({ page }) => {
  await page.goto(HOME_PATH);
  await openTaya(page);
  await page.locator('.hdr-full .hdr-link', { hasText: 'DESTINATIONS' }).click();
  await page.waitForURL((u) => u.pathname === HOME_PATH, { timeout: 5000 });
  await expect.poll(() => offsetFromHeader(page, 'destinations'), { timeout: 5000 }).toBeLessThan(40);
});

test('back from a restaurant page lands on the restaurant list', async ({ page }) => {
  await page.goto(HOME_PATH);
  await openTaya(page);
  await page.locator('.taya-back:visible').click();
  await page.waitForURL((u) => u.pathname === HOME_PATH);
  await expect.poll(() => offsetFromHeader(page, 'restaurants'), { timeout: 5000 }).toBeLessThan(40);
  await expect(page.locator('.hero-kicker')).toHaveCSS('opacity', '1');
});

test('the logo on a restaurant page opened directly goes to the top of home', async ({ page }) => {
  await page.goto(DETAIL_PATH);
  await expect(page.locator('.taya-kicker')).toHaveCSS('opacity', '1');
  await page.locator('.hdr-full .hdr-logo').click();
  await page.waitForURL((u) => u.pathname === HOME_PATH);
  await expect(page.locator('.hero-kicker')).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('a second visit to the restaurant page plays its entrance again', async ({ page }) => {
  await page.goto(HOME_PATH);
  await openTaya(page);
  await page.locator('.taya-back:visible').click();
  await page.waitForURL((u) => u.pathname === HOME_PATH);
  await expect(page.locator('.page-curtain')).toHaveAttribute('data-active', 'false');
  await tayaCard(page).click();
  await page.waitForURL((u) => u.pathname === DETAIL_PATH);
  // An entrance means the kicker starts below full opacity right after the curtain lifts.
  const samples: number[] = [];
  for (let i = 0; i < 20; i++) {
    samples.push(Number(await page.locator('.taya-kicker:visible').evaluate((e) => getComputedStyle(e).opacity)));
    await page.waitForTimeout(50);
  }
  expect(samples.some((o) => o < 1)).toBe(true);
});

test('navigation still works after the error page replaces a page the curtain was covering', async ({ page }) => {
  await page.goto(HOME_PATH);
  // Test-only fault: while armed, MoreRestaurants' restaurants.find(r => r.slug === slug) throws,
  // so the restaurant page fails to render under the covering curtain and [lang]/error.tsx
  // takes over (and unmounts the curtain mid-cover). No production code is involved.
  await page.evaluate(() => {
    const w = window as unknown as { failRender: boolean };
    w.failRender = true;
    const find = Array.prototype.find;
    Array.prototype.find = function (this: unknown[], ...args: Parameters<typeof find>) {
      if (w.failRender && String(args[0]).includes('slug')) throw new Error('forced render failure');
      return find.apply(this, args);
    } as typeof find;
  });
  await tayaCard(page).click();
  await expect(page.getByRole('heading', { name: 'We could not load this page.' })).toBeVisible();
  reactErrors = []; // the forced failure is expected

  await page.evaluate(() => ((window as unknown as { failRender: boolean }).failRender = false));
  await page.getByRole('button', { name: 'TRY AGAIN' }).click();
  await expect(page.locator('.taya-kicker:visible')).toBeVisible();
  await expect(page.locator('.page-curtain')).toHaveAttribute('data-active', 'false');

  await page.locator('.taya-back:visible').click();
  await page.waitForURL((u) => u.pathname === HOME_PATH, { timeout: 5000 });
});
