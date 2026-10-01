import { describe, expect, it } from 'vitest';
// Next 16.3.7 ships this name; the docs' unstable_doesProxyMatch does not exist yet (spec §13).
import { unstable_doesMiddlewareMatch as matches } from 'next/experimental/testing/server';
import { config } from '@/proxy';

const m = (url: string) => matches({ config, url });

describe('proxy matcher', () => {
  it.each(['/', '/restaurants', '/restaurants/taya-house', '/anything', '/english', '/admin', '/admin/sign-in', '/admin/a/b'])(
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
