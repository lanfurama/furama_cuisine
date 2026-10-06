import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

// The proxy's one database read (lib/i18n/enabled-locales.ts), tested on its own; here en and vi are on.
const enabled = vi.fn(async (): Promise<readonly string[]> => ['en', 'vi']);
vi.mock('@/lib/i18n/enabled-locales', () => ({ enabledLocalesBestEffort: () => enabled() }));
const { proxy } = await import('@/proxy');

const SESSION = 'better-auth.session_token';
const get = (path: string, init: { cookie?: string; headers?: Record<string, string> } = {}) =>
  proxy(
    new NextRequest(`http://localhost:3000${path}`, {
      headers: { ...(init.cookie ? { cookie: init.cookie } : {}), ...init.headers },
    }),
  );
const nonceOf = (csp: string | null) => /'nonce-([A-Za-z0-9+/_-]+={0,2})'/.exec(csp ?? '')?.[1];

describe('proxy: /admin without a session cookie', () => {
  it.each([
    ['/admin', '/admin/sign-in'],
    ['/admin/users', '/admin/sign-in?next=%2Fadmin%2Fusers'],
    ['/admin/users?tab=moi&x=1', '/admin/sign-in?next=%2Fadmin%2Fusers%3Ftab%3Dmoi%26x%3D1'],
    ['/admin?x=1', '/admin/sign-in?next=%2Fadmin%3Fx%3D1'],
    // The RSC request id of a client navigation is not part of where the user was going.
    ['/admin/users?_rsc=abc', '/admin/sign-in?next=%2Fadmin%2Fusers'],
    // Nor is an old inbox search: guest data stays out of URLs (phase-4 ruling SEC-2).
    ['/admin/reservations?q=0905123456&tab=all', '/admin/sign-in?next=%2Fadmin%2Freservations%3Ftab%3Dall'],
    ['/admin/reservations?q=Nguyen', '/admin/sign-in?next=%2Fadmin%2Freservations'],
  ])('%s → 307 %s', async (path, location) => {
    const res = await get(path);
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname + new URL(res.headers.get('location')!).search).toBe(location);
    expect(res.headers.get('content-security-policy')).toBeNull();
  });

  it.each(['/admin/sign-in', '/admin/accept-invite', '/admin/reset-password'])('%s is public', async (path) => {
    const res = await get(path);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(nonceOf(res.headers.get('content-security-policy'))).toBeTruthy();
  });

  it('a public page is matched exactly, not by prefix', async () => {
    expect((await get('/admin/sign-in-x')).status).toBe(307);
    expect((await get('/admin/reset-password/extra')).status).toBe(307);
  });
});

describe('proxy: /admin with a session cookie', () => {
  it.each([SESSION, `__Secure-${SESSION}`])('passes with %s and sets the admin headers', async (name) => {
    const res = await get('/admin/users', { cookie: `${name}=abc.def` });
    expect(res.status).toBe(200);
    const csp = res.headers.get('content-security-policy');
    const nonce = nonceOf(csp);
    expect(nonce).toBeTruthy();
    expect(csp).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(res.headers.get('referrer-policy')).toBe('same-origin');
    // Next reads the nonce back from the *request* header it forwards to the render.
    expect(res.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
  });

  it('makes a new nonce for every request', async () => {
    const a = nonceOf((await get('/admin', { cookie: `${SESSION}=x` })).headers.get('content-security-policy'));
    const b = nonceOf((await get('/admin', { cookie: `${SESSION}=x` })).headers.get('content-security-policy'));
    expect(a).not.toBe(b);
  });

  it('ignores cookies with other names', async () => {
    expect((await get('/admin', { cookie: 'better-auth.session_data=x; other=y' })).status).toBe(307);
  });
});

describe('proxy: guest paths go to a language the database has on', () => {
  it.each([
    [{ headers: { 'accept-language': 'vi-VN,vi;q=0.9' } }, '/vi/restaurants'],
    [{ cookie: 'NEXT_LOCALE=vi' }, '/vi/restaurants'],
    [{ headers: { 'accept-language': 'ko' } }, '/en/restaurants'],
  ])('%j → 307 %s', async (init, location) => {
    const res = await get('/restaurants', init);
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe(location);
  });

  it('serves en alone when the database read fell back', async () => {
    enabled.mockResolvedValueOnce(['en']);
    const res = await get('/', { headers: { 'accept-language': 'vi' } });
    expect(new URL(res.headers.get('location')!).pathname).toBe('/en');
  });

  it('lower-cases an upper-case language prefix with a permanent redirect, keeping the query', async () => {
    const res = await get('/EN/restaurants/taya-house?x=1');
    expect(res.status).toBe(308);
    const to = new URL(res.headers.get('location')!);
    expect(to.pathname + to.search).toBe('/en/restaurants/taya-house?x=1');
    expect((await get('/Zh-Hans')).headers.get('location')).toMatch(/\/zh-hans$/);
  });

  it('leaves a capitalised word that is no language code to the locale redirect', async () => {
    const res = await get('/Restaurants', { headers: { 'accept-language': 'en' } });
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/en/Restaurants');
  });
});

describe('proxy: guest paths are untouched', () => {
  it('redirects an unprefixed path to a locale, with no admin headers', async () => {
    const res = await get('/restaurants?x=1', { headers: { 'accept-language': 'vi' } });
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/vi/restaurants');
    expect(res.headers.get('vary')).toContain('Accept-Language');
    expect(res.headers.get('content-security-policy')).toBeNull();
    expect(res.headers.get('x-frame-options')).toBeNull();
  });
});
