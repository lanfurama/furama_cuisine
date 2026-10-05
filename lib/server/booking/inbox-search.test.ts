import { describe, expect, it } from 'vitest';
import { COOKIE_BUDGET, INBOX_SEARCHES_KEPT, decodeSearch, encodeSearches, rememberSearch, searchText } from './inbox-search';

const ids = ['0a1b2c3d', '1a1b2c3d', '2a1b2c3d', '3a1b2c3d', '4a1b2c3d', '5a1b2c3d'];

describe('inbox search kept off the URL', () => {
  it('reads what staff typed: trimmed, at most 100 characters, nothing below 2', () => {
    expect(searchText('  0905 123 456 ')).toBe('0905 123 456');
    expect(searchText('x'.repeat(150))).toHaveLength(100);
    expect(searchText('a')).toBeNull();
    expect(searchText('')).toBeNull();
    expect(searchText(null)).toBeNull();
  });

  it('finds the search the URL id names, Vietnamese and quotes included', () => {
    const cookie = encodeSearches([{ id: '0a1b2c3d', q: 'Nguyễn "Ánh"' }]);
    expect(decodeSearch('0a1b2c3d', cookie)).toEqual({ q: 'Nguyễn "Ánh"' });
  });

  it('no id in the URL: no search', () => {
    expect(decodeSearch(undefined, encodeSearches([{ id: '0a1b2c3d', q: 'abc' }]))).toBeNull();
  });

  it('keeps the last five searches (phase-5 F5): Back to an earlier search, or another tab’s, still finds its own results', () => {
    let cookie: string | undefined;
    for (const [i, id] of ids.slice(0, INBOX_SEARCHES_KEPT).entries()) cookie = rememberSearch(cookie, { id, q: `search ${i}` });
    for (const [i, id] of ids.slice(0, INBOX_SEARCHES_KEPT).entries()) expect(decodeSearch(id, cookie)).toEqual({ q: `search ${i}` });
    // A sixth pushes the oldest out: that page says expired, never another search's results.
    cookie = rememberSearch(cookie, { id: ids[5], q: 'search 5' });
    expect(decodeSearch(ids[0], cookie)).toBe('expired');
    expect(decodeSearch(ids[1], cookie)).toEqual({ q: 'search 1' });
    expect(JSON.parse(cookie)).toHaveLength(INBOX_SEARCHES_KEPT);
    // The longest Vietnamese searches (9 bytes a letter, stored percent-encoded) keep the cookie under 4 KB:
    // older ones drop out sooner, the newest always stays.
    let longest: string | undefined;
    for (const id of ids) longest = rememberSearch(longest, { id, q: 'Ữ'.repeat(100) });
    expect(encodeURIComponent(longest!).length).toBeLessThanOrEqual(COOKIE_BUDGET);
    expect(decodeSearch(ids[5], longest)).toEqual({ q: 'Ữ'.repeat(100) });
    expect(decodeSearch(ids[4], longest)).toEqual({ q: 'Ữ'.repeat(100) });
  });

  it.each([
    ['five searches since', ids[0], ids.slice(1).reduce<string | undefined>((c, id) => rememberSearch(c, { id, q: 'abc' }), encodeSearches([{ id: ids[0], q: 'x1' }]))],
    ['the cookie expired', '0a1b2c3d', undefined],
    ['a hand-made id', '../../x', encodeSearches([{ id: '../../x', q: 'abc' }])],
    ['a cookie this code did not write', '0a1b2c3d', '{"id":"0a1b2c3d"}'],
    ['the phase-4 cookie (one search)', '0a1b2c3d', '["0a1b2c3d","abc"]'],
    ['not JSON', '0a1b2c3d', 'q=abc'],
  ])('%s: expired, never another search’s results', (_, id, cookie) => {
    expect(decodeSearch(id, cookie)).toBe('expired');
  });
});
