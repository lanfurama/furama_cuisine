import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE } from './locales';
import { ENABLED_LOCALE_CODES, SITE_LOCALE_ROWS, siteLocaleRows } from './site-locales';

describe('SITE_LOCALES', () => {
  it('works as written: one enabled default, the same as DEFAULT_LOCALE, every code in the catalogue', () => {
    expect(SITE_LOCALE_ROWS.filter((l) => l.isDefault).map((l) => l.code)).toEqual([DEFAULT_LOCALE]);
    expect(ENABLED_LOCALE_CODES).toContain(DEFAULT_LOCALE);
  });

  it('turns the list into rows, in its order', () => {
    expect(siteLocaleRows([{ code: 'en', enabled: true, default: true }, { code: 'ko', enabled: false }])).toEqual([
      { code: 'en', english: 'English', bcp47: 'en', nativeName: 'English', shortLabel: 'EN', script: 'latin', isDefault: true, isEnabled: true, sortOrder: 10 },
      { code: 'ko', english: 'Korean', bcp47: 'ko', nativeName: '한국어', shortLabel: 'KO', script: 'hangul', isDefault: false, isEnabled: false, sortOrder: 20 },
    ]);
  });

  it('refuses a list that cannot work', () => {
    expect(() => siteLocaleRows([{ code: 'en', enabled: true }])).toThrow(/exactly one default/);
    expect(() => siteLocaleRows([{ code: 'en', enabled: true, default: true }, { code: 'vi', enabled: true, default: true }])).toThrow(/exactly one default/);
    expect(() => siteLocaleRows([{ code: 'en', enabled: false, default: true }])).toThrow(/must be enabled/);
    expect(() => siteLocaleRows([{ code: 'en', enabled: true, default: true }, { code: 'en', enabled: true }])).toThrow(/twice/);
    expect(() => siteLocaleRows([{ code: 'en', enabled: true, default: true }, { code: 'xx', enabled: true }])).toThrow(/LANGUAGE_CATALOG/);
  });
});
