import { describe, expect, it } from 'vitest';
// Next 16.3.7 ships this name; the docs' unstable_doesProxyMatch does not exist yet (spec §13).
import { unstable_doesMiddlewareMatch as matches } from 'next/experimental/testing/server';
import { config } from '@/proxy';

const m = (url: string) => matches({ config, url });

describe('proxy matcher', () => {
  it.each([
    '/',
    '/restaurants',
    '/restaurants/taya-house',
    '/anything',
    '/english',
    '/admin',
    '/admin/sign-in',
    '/admin/sign-in?next=%2Fadmin%2Fusers',
    '/admin/accept-invite?token=abc',
    '/admin/reset-password',
    '/admin/users',
    '/admin/a/b',
  ])(
    'runs on %s',
    (u) => expect(m(u)).toBe(true),
  );

  // Locale-prefixed paths never reach the proxy, so a redirect to /en can never loop.
  it.each([
    '/en',
    '/en/',
    '/en/restaurants/taya-house',
    '/vi/x',
    '/zh-hans',
    '/zh-hans/restaurants',
    '/pt-br/a',
    '/xx/nope',
    '/api/availability',
    // Better Auth's HTTP endpoints never pass through the proxy (spec §7.1 blocks /api/auth/admin/* in the auth hooks instead).
    '/api/auth/sign-in/email',
    '/api/auth/admin/set-role',
    '/api',
    '/_next/static/a.js',
    '/_next/image',
    '/favicon.ico',
    '/icon.svg',
    '/sitemap.xml',
    '/robots.txt',
    '/images/a.png',
  ])('skips %s', (u) => expect(m(u)).toBe(false));

  // Known limit: a top-level unprefixed path of 2–3 letters looks like a locale code,
  // so the proxy skips it and it 404s. Real unprefixed top-level names need 4+ letters.
  it('treats a 2–3 letter first segment as a locale', () => expect(m('/faq/x')).toBe(false));
});

// BotID's challenge script and API (botid/next/config rewrites them to Vercel). The proxy runs
// before rewrites (proxy.md:236-247), so matching here would send them to /en/149e9513-….
describe('proxy matcher and BotID', () => {
  it.each([
    '/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3/a-4-a/c.js?i=0&v=3&h=x',
    '/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3/p.js',
    '/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3/tl',
    '/149e9513-01fa-4fb0-aad4-566afd725d1b',
  ])('skips %s', (u) => expect(m(u)).toBe(false));

  it('still runs on an unprefixed path that merely starts with digits', () => expect(m('/149e9513')).toBe(true));
});
