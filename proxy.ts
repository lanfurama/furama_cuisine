import { NextResponse, type NextRequest } from 'next/server';
import { ENABLED_LOCALES, LOCALE_COOKIE, pickLocale } from '@/lib/i18n/locales';

/*
 * Runs only on paths without a locale prefix, and on /admin. Guest pages under
 * /<locale>/… are cached and never pass through here (spec §6.1). A matcher must
 * be a build-time constant, so "has a locale prefix" means "starts with a
 * locale-shaped segment": 2–3 letters plus optional -subtags, the shape the
 * locales table allows. An unprefixed top-level page of 2–3 letters (/faq) is
 * therefore never redirected; give real top-level pages 4+ letters.
 */
export const config = {
  matcher: [
    '/admin/:path*',
    '/((?!api(?:/|$)|_next(?:/|$)|admin(?:/|$)|[a-z]{2,3}(?:-[a-z0-9]{2,8})*(?:/|$)|.*\\..*).*)',
  ],
};

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return NextResponse.next(); // phase 3: the session-cookie check
  }
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
