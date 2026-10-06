import { describe, expect, it } from 'vitest';
import { switchHref } from './LanguageSwitcher';

describe('switchHref: the same page in another language (R8-10)', () => {
  it.each([
    ['/en', '', 'vi', '/vi'],
    ['/en/', '', 'vi', '/vi'],
    ['/en/restaurants/taya-house', '', 'vi', '/vi/restaurants/taya-house'],
    ['/en/privacy', '?x=1', 'zh-hans', '/zh-hans/privacy?x=1'],
    ['/vi/restaurants/taya-house', '', 'en', '/en/restaurants/taya-house'],
  ])('%s%s in %s → %s', (pathname, search, code, href) => expect(switchHref(pathname, search, code)).toBe(href));
});
