import { describe, expect, it } from 'vitest';
import { escapeLike, normalizeReference, parseSearch } from './search';

describe('inbox search', () => {
  it('reads new and legacy references however they are typed', () => {
    expect(normalizeReference('FC-7K3QH9XA')).toBe('FC-7K3QH9XA');
    expect(normalizeReference('fc7k3qh9xa')).toBe('FC-7K3QH9XA');
    expect(normalizeReference(' fc-7k3q h9xa ')).toBe('FC-7K3QH9XA');
    expect(normalizeReference('FC-0I1LO000')).toBe('FC-01110000'); // O → 0, I/L → 1, as read over the phone
    expect(normalizeReference('FC-12345')).toBe('FC-12345');
    expect(normalizeReference('fc 12345')).toBe('FC-12345');
    expect(normalizeReference('FC-1234')).toBeNull();
    expect(normalizeReference('FC-UUUUUUUU')).toBeNull(); // U is not Crockford
    expect(normalizeReference('12345')).toBeNull();
  });

  it('turns a phone into E.164, local or international', () => {
    expect(parseSearch('0905 000 000')).toEqual({ kind: 'phone', value: '+84905000000' });
    expect(parseSearch('+84 905 000 000')).toEqual({ kind: 'phone', value: '+84905000000' });
  });

  it('searches names and emails as text, and partial digits as digits', () => {
    expect(parseSearch('Nguyễn Minh')).toEqual({ kind: 'text', value: 'Nguyễn Minh' });
    expect(parseSearch('anh@example.com')).toEqual({ kind: 'text', value: 'anh@example.com' });
    expect(parseSearch('50 00')).toEqual({ kind: 'text', value: '5000' });
    expect(parseSearch('fc-12345')).toEqual({ kind: 'reference', value: 'FC-12345' });
    expect(parseSearch(' a ')).toBeNull();
    expect(parseSearch(undefined)).toBeNull();
  });

  it('escapes LIKE wildcards', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});
