import { describe, expect, it } from 'vitest';
import { localeSearch } from './LocalePicker';

describe('localeSearch (the strings screens’ ?lang= links)', () => {
  it('sets lang and keeps the page’s other parameters, repeated ones too', () => {
    expect(localeSearch({}, 'vi')).toBe('?lang=vi');
    expect(localeSearch({ lang: 'en', tab: 'x', tag: ['a', 'b'], gone: undefined }, 'ko')).toBe('?tab=x&tag=a&tag=b&lang=ko');
  });
});
