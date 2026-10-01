import { describe, expect, it } from 'vitest';
import { LOCALE_CODE_RE, pickLocale, toBcp47 } from './locales';

describe('pickLocale', () => {
  const en = ['en'];
  const multi = ['en', 'vi', 'zh-hans'];
  it('defaults to en', () => expect(pickLocale(undefined, null, en)).toBe('en'));
  it('ignores a cookie for a language that is not enabled', () => expect(pickLocale('vi', null, en)).toBe('en'));
  it('ignores Accept-Language for a language that is not enabled', () =>
    expect(pickLocale(undefined, 'vi-VN,vi;q=0.9', en)).toBe('en'));
  it('lets the cookie win over Accept-Language', () => expect(pickLocale('vi', 'en', multi)).toBe('vi'));
  it('uses q ordering and the primary subtag', () =>
    expect(pickLocale(undefined, 'fr;q=0.9, vi-VN;q=0.8, en;q=0.1', multi)).toBe('vi'));
  it('falls back when nothing enabled matches', () => expect(pickLocale(undefined, 'fr,de', multi)).toBe('en'));
});

describe('LOCALE_CODE_RE', () => {
  it.each(['en', 'vi', 'zh-hans', 'pt-br', 'es-419'])('accepts %s', (code) => expect(LOCALE_CODE_RE.test(code)).toBe(true));
  it.each(['EN', 'e', 'zh_hans', 'zh-', '-en', 'en us', '', 'english'])('rejects %j', (code) =>
    expect(LOCALE_CODE_RE.test(code)).toBe(false));
});

describe('toBcp47', () => {
  it.each([
    ['en', 'en'],
    ['vi', 'vi'],
    ['zh-hans', 'zh-Hans'],
    ['pt-br', 'pt-BR'],
    ['es-419', 'es-419'],
    ['zh-hans-cn', 'zh-Hans-CN'],
  ])('%s -> %s', (code, tag) => expect(toBcp47(code)).toBe(tag));
});
