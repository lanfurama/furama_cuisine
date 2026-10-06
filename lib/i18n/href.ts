/*
 * Internal guest URLs. Every link and router.push to a guest page goes through
 * these, so the locale prefix (spec §6.1) is never written by hand.
 */
export function localeHref(locale: string, path = '/'): string {
  // The path after the language: always rooted, and the home page's own "/" dropped even before a query or hash.
  const i = path.search(/[?#]/);
  const [route, tail] = i < 0 ? [path, ''] : [path.slice(0, i), path.slice(i)];
  const rooted = route.startsWith('/') ? route : `/${route}`;
  return `/${locale}${rooted === '/' ? '' : rooted}${tail}`;
}

export function homeHref(locale: string): string {
  return localeHref(locale);
}

export function restaurantHref(locale: string, slug: string): string {
  return localeHref(locale, `/restaurants/${slug}`);
}
