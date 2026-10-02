import { describe, expect, it } from 'vitest';
import { formatMessage, usesIcuSyntax } from './format';
import { ADMIN_SCREENS, KEY_PATTERN, REGISTRY, STRING_KEYS, type StringDef } from './registry';
import { resolveStrings } from './resolve';

describe('registry', () => {
  it.each(STRING_KEYS)('%s is well formed', (key) => {
    const def: StringDef = REGISTRY[key];
    expect(key).toMatch(KEY_PATTERN);
    expect(def.en.length).toBeGreaterThan(0);
    expect(def.en.length).toBeLessThanOrEqual(def.maxLength);
    if (def.vi) expect(def.vi.length).toBeLessThanOrEqual(def.maxLength);
    expect(def.context.length).toBeGreaterThan(10);
    expect(ADMIN_SCREENS).toContain(def.screen);
    // Declared variables and placeholders in the text agree, in every language.
    for (const text of [def.en, def.vi].filter((t): t is string => !!t)) {
      const used = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(used).toEqual([...(def.vars ?? [])].sort());
      expect(usesIcuSyntax(text)).toBe(false); // phase 2 has no ICU parser
    }
  });
});

describe('formatMessage', () => {
  it('fills known variables and leaves unknown ones visible', () => {
    expect(formatMessage('{a} and {b}', { a: 'x' })).toBe('x and {b}');
    expect(formatMessage('{n} guests', { n: 4 })).toBe('4 guests');
  });
  it('flags ICU plural syntax', () => {
    expect(usesIcuSyntax('{n, plural, one {# guest} other {# guests}}')).toBe(true);
  });
});

describe('resolveStrings', () => {
  const keys = ['error.full', 'error.past'] as const;
  it('uses the default-language row, else the registry', () => {
    const out = resolveStrings([{ key: 'error.full', locale: 'en', value: 'Sold out.' }], keys, 'en', 'en');
    expect(out['error.full']).toBe('Sold out.');
    expect(out['error.past']).toContain('can no longer be booked online');
  });
  it('falls back per key: a missing vi row shows the English row, not an empty string', () => {
    const rows = [
      { key: 'error.full', locale: 'en', value: 'Sold out.' },
      { key: 'error.past', locale: 'vi', value: 'Đã qua giờ.' },
    ];
    const out = resolveStrings(rows, keys, 'vi', 'en');
    expect(out).toEqual({ 'error.full': 'Sold out.', 'error.past': 'Đã qua giờ.' });
  });
});
