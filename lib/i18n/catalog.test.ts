import { describe, expect, it } from 'vitest';
import { LANGUAGE_CATALOG, catalogLanguage } from './catalog';
import { LOCALE_CODE_RE, toBcp47 } from './locales';
import { SCRIPTS, isScript } from './scripts';

describe('the language catalogue', () => {
  it.each(LANGUAGE_CATALOG.map((l) => [l.code, l] as const))('%s: a URL code, its BCP 47 spelling, a script with fonts', (_, l) => {
    expect(LOCALE_CODE_RE.test(l.code)).toBe(true);
    expect(toBcp47(l.code)).toBe(l.bcp47);
    expect(Intl.getCanonicalLocales(l.bcp47)[0]).toBe(l.bcp47);
    expect(isScript(l.script)).toBe(true);
    expect(l.nativeName.trim()).not.toBe('');
    expect(l.shortLabel.trim()).not.toBe('');
  });

  it('lists each code once', () => {
    const codes = LANGUAGE_CATALOG.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  // Migration 004 seeds en and vi; their rows must be what the catalogue would add.
  it('agrees with the seeded en and vi rows', () => {
    expect(catalogLanguage('en')).toMatchObject({ bcp47: 'en', nativeName: 'English', shortLabel: 'EN', script: 'latin' });
    expect(catalogLanguage('vi')).toMatchObject({ bcp47: 'vi', nativeName: 'Tiếng Việt', shortLabel: 'VI', script: 'vietnamese' });
  });

  it('covers every script it may use', () => {
    expect(new Set(LANGUAGE_CATALOG.map((l) => l.script))).toEqual(new Set(SCRIPTS));
  });
});
