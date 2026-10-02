import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { proxy } from '@/proxy';

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
  ])('%s → 307 %s', (path, location) => {
    const res = get(path);
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname + new URL(res.headers.get('location')!).search).toBe(location);
    expect(res.headers.get('content-security-policy')).toBeNull();
  });

  it.each(['/admin/sign-in', '/admin/accept-invite', '/admin/reset-password'])('%s is public', (path) => {
    const res = get(path);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(nonceOf(res.headers.get('content-security-policy'))).toBeTruthy();
  });

  it('a public page is matched exactly, not by prefix', () => {
    expect(get('/admin/sign-in-x').status).toBe(307);
    expect(get('/admin/reset-password/extra').status).toBe(307);
  });
});

describe('proxy: /admin with a session cookie', () => {
  it.each([SESSION, `__Secure-${SESSION}`])('passes with %s and sets the admin headers', (name) => {
    const res = get('/admin/users', { cookie: `${name}=abc.def` });
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

  it('makes a new nonce for every request', () => {
    const a = nonceOf(get('/admin', { cookie: `${SESSION}=x` }).headers.get('content-security-policy'));
    const b = nonceOf(get('/admin', { cookie: `${SESSION}=x` }).headers.get('content-security-policy'));
    expect(a).not.toBe(b);
  });

  it('ignores cookies with other names', () => {
    expect(get('/admin', { cookie: 'better-auth.session_data=x; other=y' }).status).toBe(307);
  });
});

describe('proxy: guest paths are untouched', () => {
  it('redirects an unprefixed path to a locale, with no admin headers', () => {
    const res = get('/restaurants?x=1', { headers: { 'accept-language': 'vi' } });
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/en/restaurants');
    expect(res.headers.get('vary')).toContain('Accept-Language');
    expect(res.headers.get('content-security-policy')).toBeNull();
    expect(res.headers.get('x-frame-options')).toBeNull();
  });
});
