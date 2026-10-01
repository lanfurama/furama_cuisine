/*
 * Internal guest URLs. Every link and router.push to a guest page goes through
 * these, so the locale prefix (spec §6.1) is never written by hand.
 */
export function localeHref(locale: string, path = '/'): string {
  return `/${locale}${path === '/' ? '' : path}`;
}

export function homeHref(locale: string): string {
  return localeHref(locale);
}

export function restaurantHref(locale: string, slug: string): string {
  return localeHref(locale, `/restaurants/${slug}`);
}
