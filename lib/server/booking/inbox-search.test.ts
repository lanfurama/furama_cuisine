import { describe, expect, it } from 'vitest';
import { decodeSearch, encodeSearch, searchText } from './inbox-search';

describe('inbox search kept off the URL', () => {
  it('reads what staff typed: trimmed, at most 100 characters, nothing below 2', () => {
    expect(searchText('  0905 123 456 ')).toBe('0905 123 456');
    expect(searchText('x'.repeat(150))).toHaveLength(100);
    expect(searchText('a')).toBeNull();
    expect(searchText('')).toBeNull();
    expect(searchText(null)).toBeNull();
  });

  it('finds the search the URL id names, Vietnamese and quotes included', () => {
    const cookie = encodeSearch({ id: '0a1b2c3d', q: 'Nguyễn "Ánh"' });
    expect(decodeSearch('0a1b2c3d', cookie)).toEqual({ q: 'Nguyễn "Ánh"' });
  });

  it('no id in the URL: no search', () => {
    expect(decodeSearch(undefined, encodeSearch({ id: '0a1b2c3d', q: 'abc' }))).toBeNull();
  });

  it.each([
    ['another tab searched since', 'ffffffff', encodeSearch({ id: '0a1b2c3d', q: 'abc' })],
    ['the cookie expired', '0a1b2c3d', undefined],
    ['a hand-made id', '../../x', encodeSearch({ id: '../../x', q: 'abc' })],
    ['a cookie this code did not write', '0a1b2c3d', '{"id":"0a1b2c3d"}'],
    ['not JSON', '0a1b2c3d', 'q=abc'],
  ])('%s: expired, never another search’s results', (_, id, cookie) => {
    expect(decodeSearch(id, cookie)).toBe('expired');
  });
});
