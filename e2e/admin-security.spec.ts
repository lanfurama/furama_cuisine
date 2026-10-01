import { expectHydrated, watchCsp } from './csp';
import { STAFF, expect, seedStaff, signIn, test } from './staff-fixtures';

/*
 * Spec §11: every admin response carries a per-request nonce CSP plus
 * framing and indexing headers, Next stamps that nonce on every script, and
 * the page hydrates with no CSP violation. Guest pages stay prerendered and
 * get none of it. Spec §6.1: without a session cookie the proxy sends /admin/*
 * to the sign-in page, except the three public pages.
 */

test.beforeAll(() => seedStaff());

const nonceOf = (csp: string | undefined) => /'nonce-([A-Za-z0-9+/_-]+={0,2})'/.exec(csp ?? '')?.[1];

test.describe('admin response headers', () => {
  test('/admin/sign-in carries a nonce CSP, and every <script> has that nonce', async ({ request }) => {
    const res = await request.get('/admin/sign-in');
    expect(res.status()).toBe(200);
    const h = res.headers();
    const csp = h['content-security-policy'];
    const nonce = nonceOf(csp);
    expect(nonce, `CSP: ${csp}`).toBeTruthy();
    expect(csp).toBe(
      [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
        `style-src 'self' 'nonce-${nonce}'`,
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; '),
    );
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-robots-tag']).toBe('noindex, nofollow');
    expect(h['referrer-policy']).toBe('same-origin');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
    expect(h['cache-control']).toContain('private');
    expect(h['cache-control']).toContain('no-store');

    const html = await res.text();
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(scripts.length).toBeGreaterThan(3);
    expect(scripts.filter((s) => !s.includes(` nonce="${nonce}"`))).toEqual([]);
    // style-src has no 'unsafe-inline': the markup must have no style="" and no un-nonced <style>.
    expect(html).not.toMatch(/\sstyle="/);
    expect([...html.matchAll(/<style\b[^>]*>/g)].filter((m) => !m[0].includes(`nonce="${nonce}"`))).toEqual([]);
    expect(html).toContain('<html lang="vi"');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow"/>');
  });

  test('the nonce is new on every response', async ({ request }) => {
    const a = nonceOf((await request.get('/admin/sign-in')).headers()['content-security-policy']);
    const b = nonceOf((await request.get('/admin/sign-in')).headers()['content-security-policy']);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });

  test('guest pages get no admin CSP and stay prerendered', async ({ request }) => {
    const res = await request.get('/en');
    expect(res.status()).toBe(200);
    const h = res.headers();
    expect(h['content-security-policy']).toBeUndefined();
    expect(h['x-robots-tag']).toBeUndefined();
    expect(h['x-nextjs-prerender']).toMatch(/^1(, 1)*$/); // next start sends it twice for prerendered pages
    expect(await res.text()).not.toContain(' nonce="');
  });
});

test.describe('proxy: session cookie gate', () => {
  test('signed out, /admin/* goes to sign-in and keeps where it was going', async ({ request }) => {
    const home = await request.get('/admin', { maxRedirects: 0 });
    expect(home.status()).toBe(307);
    expect(home.headers().location).toBe('/admin/sign-in');

    const users = await request.get('/admin/users?tab=moi', { maxRedirects: 0 });
    expect(users.status()).toBe(307);
    expect(users.headers().location).toBe(`/admin/sign-in?next=${encodeURIComponent('/admin/users?tab=moi')}`);
  });

  for (const path of ['/admin/sign-in', '/admin/accept-invite?token=x', '/admin/reset-password']) {
    test(`signed out, ${path} is not redirected`, async ({ request }) => {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status()).toBe(200);
      expect(nonceOf(res.headers()['content-security-policy'])).toBeTruthy();
    });
  }
});

test.describe('hydration under the CSP', () => {
  test('sign-in hydrates with no violation', async ({ page }) => {
    const violations = await watchCsp(page);
    await page.goto('/admin/sign-in');
    await expectHydrated(page);
    // A client-side state update (useActionState) proves the client bundle runs.
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page.locator('form').getByText('Nhập email công việc, ví dụ ten@furamavietnam.com.')).toBeVisible();
    expect(violations).toEqual([]);
  });

  test('the public reset and accept-invite pages hydrate with no violation', async ({ page }) => {
    const violations = await watchCsp(page);
    for (const path of ['/admin/reset-password', '/admin/reset-password?token=x', '/admin/accept-invite?token=x']) {
      await page.goto(path);
      await expectHydrated(page);
    }
    expect(violations).toEqual([]);
  });

  test('signing in moves into the shell without a document request or a violation', async ({ page }) => {
    const violations = await watchCsp(page);
    await page.goto('/admin/sign-in');
    await expectHydrated(page);
    // The action's redirect is a soft navigation: the page keeps its first nonce,
    // and the shell's new chunks load under 'strict-dynamic'.
    let documents = 0;
    page.on('request', (r) => {
      if (r.resourceType() === 'document') documents++;
    });
    await signIn(page, STAFF.admin.email, STAFF.admin.password);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'Tổng quan' })).toBeVisible();
    await expectHydrated(page);
    // A link inside the shell: another soft navigation with chunks of its own.
    await page.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link', { name: 'Nhân viên' }).click();
    await expect(page.getByRole('heading', { name: 'Nhân viên', level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/users$/);
    expect(documents).toBe(0);
    expect(violations).toEqual([]);
  });

  test('an unknown admin URL gets the Vietnamese not-found page, inside the admin document', async ({ page, context }) => {
    // Any session cookie passes the proxy; the catch-all route itself reads none.
    await context.addCookies([{ name: 'better-auth.session_token', value: 'x', url: test.info().project.use.baseURL! }]);
    const violations = await watchCsp(page);
    await page.goto('/admin/khong-co-trang-nay');
    await expect(page.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
    expect(violations).toEqual([]);
  });
});
