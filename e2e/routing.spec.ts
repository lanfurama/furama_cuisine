import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { DETAIL_PATH, HOME_PATH } from './paths';

/** One request without following redirects; `to` is the Location as path + query. */
async function hop(request: APIRequestContext, path: string, headers: Record<string, string> = {}) {
  const res = await request.get(path, { maxRedirects: 0, headers });
  const location = res.headers()['location'];
  const to = location ? new URL(location, 'http://localhost') : null;
  return { status: res.status(), to: to ? to.pathname + to.search : null, vary: res.headers()['vary'] ?? '' };
}

test.describe('old and unprefixed links', () => {
  test('/ goes to the default language with a temporary redirect that varies on cookie and language', async ({
    request,
  }) => {
    const r = await hop(request, '/');
    expect(r).toMatchObject({ status: 307, to: HOME_PATH });
    expect(r.vary).toMatch(/cookie/i);
    expect(r.vary).toMatch(/accept-language/i);
  });

  test('an unprefixed deep link keeps its path and query', async ({ request }) => {
    expect(await hop(request, '/x?y=1')).toMatchObject({ status: 307, to: '/en/x?y=1' });
  });

  test('a language that is not enabled, asked for by header or cookie, still lands on /en', async ({ request }) => {
    expect(await hop(request, '/', { 'accept-language': 'vi-VN,vi;q=0.9' })).toMatchObject({ status: 307, to: '/en' });
    expect(await hop(request, '/', { cookie: 'NEXT_LOCALE=vi' })).toMatchObject({ status: 307, to: '/en' });
  });

  test('the old Tàya House URL moved permanently and keeps its query', async ({ request }) => {
    expect(await hop(request, '/taya-house')).toMatchObject({ status: 308, to: DETAIL_PATH });
    expect(await hop(request, '/taya-house?utm_source=mail')).toMatchObject({
      status: 308,
      to: `${DETAIL_PATH}?utm_source=mail`,
    });
  });

  test('the old URL with a trailing slash still ends on the restaurant page', async ({ request }) => {
    const res = await request.get('/taya-house/');
    expect(res.status()).toBe(200);
    expect(new URL(res.url()).pathname).toBe(DETAIL_PATH);
  });

  test('guest pages, the API and files are served without a redirect', async ({ request }) => {
    expect((await hop(request, HOME_PATH)).status).toBe(200);
    expect((await hop(request, DETAIL_PATH)).status).toBe(200);
    expect((await hop(request, '/api/availability')).status).toBe(400); // the handler answered: no restaurant given
    expect((await hop(request, '/icon.svg')).status).toBe(200);
  });
});

test.describe('pages that do not exist', () => {
  test('a language that is not enabled is a real 404, in the site look, that search engines skip', async ({
    request,
    page,
  }) => {
    for (const path of ['/vi', '/fr', '/zz/restaurants/taya-house']) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(404);
      const html = await res.text();
      expect(html, path).toContain('noindex');
      expect(html, path).toContain('Page not found'); // Next's bare 404 says "This page could not be found."
    }
    // The server HTML of this 404 is a __next_error__ shell with the page in the RSC
    // payload, so the site look (ruling 2: not Next's bare 404) is checked in a browser.
    const res = await page.goto('/vi');
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('Be Vietnam Pro');
  });

  test('the cached 404 of a disabled language carries the locales tag, so enabling it clears the 404', async ({
    request,
  }) => {
    test.skip(!!process.env.E2E_BASE_URL, 'reads the cache of the production build that next start serves');
    expect((await request.get('/vi')).status()).toBe(404);
    expect((await request.get('/vi')).status()).toBe(404);
    const meta = join(process.cwd(), '.next', 'server', 'app', 'vi.meta');
    await expect.poll(() => existsSync(meta)).toBe(true);
    const tags = String(JSON.parse(readFileSync(meta, 'utf8')).headers['x-next-cache-tags']).split(',');
    expect(tags).toContain('locales');
  });

  test('a file a crawler asks for is a 404, not a server error, though its name lands where a language goes', async ({
    request,
  }) => {
    // A path with a dot skips the proxy (proxy.ts), so /favicon.ico is the home page of a language
    // "favicon.ico": the page checks the language before it reads (requireEnabledLocale).
    for (const path of ['/favicon.ico', '/apple-touch-icon.png', '/wp-login.php', '/favicon.ico/privacy']) {
      expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
    }
  });

  test('an unknown restaurant says so and is not indexed', async ({ request }) => {
    const res = await request.get('/en/restaurants/nope');
    // The first request streams its answer (200); later ones get the cached 404 (spec deviation 8).
    expect([200, 404]).toContain(res.status());
    const html = await res.text();
    expect(html).toContain('noindex');
    expect(html).toContain('Page not found');
  });

  test('an unknown restaurant has its own tab title, not the home page one', async ({ page }) => {
    await page.goto('/en/restaurants/nope');
    await expect(page).toHaveTitle('Page not found — Furama Cuisine');
  });

  test('a URL that matches no page gets the site 404 in the site fonts', async ({ page }) => {
    const res = await page.goto('/nothing/here');
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('Be Vietnam Pro');
  });

  test('the header on an unknown restaurant page still takes you home', async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
    await page.goto('/en/restaurants/nope');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await page.locator('.hdr-full .hdr-link', { hasText: 'DESTINATIONS' }).click();
    await page.waitForURL((u) => u.pathname === HOME_PATH);
    await expect(page.locator('#destinations')).toBeInViewport();
  });
});
