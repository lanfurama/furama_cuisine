import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';
import { adminContentSecurityPolicy, adminSecurityHeaders, createNonce } from '@/lib/admin/csp';
import { ADMIN_SIGN_IN, isAdminPath, isPublicAdminPath } from '@/lib/admin/paths';
import { ENABLED_LOCALES, LOCALE_COOKIE, pickLocale } from '@/lib/i18n/locales';

/*
 * Runs only on paths without a locale prefix, and on /admin. Guest pages under
 * /<locale>/… are cached and never pass through here (spec §6.1). A matcher must
 * be a build-time constant, so "has a locale prefix" means "starts with a
 * locale-shaped segment": 2–3 letters plus optional -subtags, the shape the
 * locales table allows. An unprefixed top-level page of 2–3 letters (/faq) is
 * therefore never redirected; give real top-level pages 4+ letters.
 * BotID's paths (/149e9513-…/, rewritten to Vercel by withBotId in
 * next.config.ts) are skipped too: the proxy runs before rewrites
 * (proxy.md:236-247), so it would send them to /en/149e9513-… instead.
 */
export const config = {
  matcher: [
    '/admin/:path*',
    '/((?!api(?:/|$)|_next(?:/|$)|admin(?:/|$)|149e9513-01fa-4fb0-aad4-566afd725d1b(?:/|$)|[a-z]{2,3}(?:-[a-z0-9]{2,8})*(?:/|$)|.*\\..*).*)',
  ],
};

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isAdminPath(pathname)) return adminProxy(request);

  const locale = pickLocale(
    request.cookies.get(LOCALE_COOKIE)?.value,
    request.headers.get('accept-language'),
    ENABLED_LOCALES, // phase 8: the enabled locales from the database, best effort
  );
  const url = request.nextUrl.clone(); // keeps the query string
  url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;
  // 307, not 308: the target depends on the cookie and Accept-Language, so no one may cache it as permanent.
  const res = NextResponse.redirect(url, 307);
  res.headers.append('Vary', 'Cookie, Accept-Language');
  return res;
}

/*
 * /admin: an optimistic check only (authentication.md:1033 — the proxy reads
 * the cookie, never the database). The cookie may be stale or forged, so every
 * admin page and action still verifies the session itself.
 */
function adminProxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // getSessionCookie knows Better Auth's names: better-auth.session_token, and
  // __Secure-better-auth.session_token once the base URL is https.
  if (!isPublicAdminPath(pathname) && !getSessionCookie(request)) {
    const url = request.nextUrl.clone();
    url.pathname = ADMIN_SIGN_IN;
    url.search = '';
    const next = new URLSearchParams(search);
    next.delete('_rsc');
    const query = next.toString();
    if (pathname !== '/admin' || query) url.searchParams.set('next', `${pathname}${query ? `?${query}` : ''}`);
    return NextResponse.redirect(url, 307);
  }

  const csp = adminContentSecurityPolicy(createNonce(), {
    dev: process.env.NODE_ENV === 'development',
    https: request.nextUrl.protocol === 'https:',
  });
  // Next takes the nonce from the request's CSP header and stamps it on its scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [name, value] of Object.entries(adminSecurityHeaders(csp))) res.headers.set(name, value);
  return res;
}
