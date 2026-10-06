import { describe, expect, it } from 'vitest';
import { homeHref, localeHref, restaurantHref } from './href';

describe('guest URLs', () => {
  it('prefixes the locale and drops the trailing slash of the home page', () => {
    expect(homeHref('en')).toBe('/en');
    expect(localeHref('zh-hans', '/')).toBe('/zh-hans');
    expect(localeHref('vi', '/restaurants')).toBe('/vi/restaurants');
  });

  it('roots a path written without its slash, and keeps a query or hash after the path (phase-2 ledger)', () => {
    expect(localeHref('vi', 'restaurants')).toBe('/vi/restaurants');
    expect(localeHref('vi', '/?a=1#b')).toBe('/vi?a=1#b');
    expect(localeHref('vi', '?a=1')).toBe('/vi?a=1');
    expect(localeHref('vi', '#top')).toBe('/vi#top');
    expect(localeHref('vi', '/privacy?x=1')).toBe('/vi/privacy?x=1');
    expect(localeHref('vi', '')).toBe('/vi');
  });

  it('builds the detail page URL from the slug', () => {
    expect(restaurantHref('en', 'taya-house')).toBe('/en/restaurants/taya-house');
  });
});
