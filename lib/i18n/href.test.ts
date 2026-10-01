import { describe, expect, it } from 'vitest';
import { homeHref, localeHref, restaurantHref } from './href';

describe('guest URLs', () => {
  it('prefixes the locale and drops the trailing slash of the home page', () => {
    expect(homeHref('en')).toBe('/en');
    expect(localeHref('zh-hans', '/')).toBe('/zh-hans');
    expect(localeHref('vi', '/restaurants')).toBe('/vi/restaurants');
  });

  it('builds the detail page URL from the slug', () => {
    expect(restaurantHref('en', 'taya-house')).toBe('/en/restaurants/taya-house');
  });
});
