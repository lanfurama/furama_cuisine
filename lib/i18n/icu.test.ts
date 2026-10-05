import { describe, expect, it } from 'vitest';
import { checkMessage, describeProblem, messageArgs } from './icu';

describe('checkMessage (spec §7.4: refuse a value whose variables differ)', () => {
  it('accepts the declared variables, in any order, plain or ICU', () => {
    expect(checkMessage('{a} and {b}', ['b', 'a'])).toEqual([]);
    expect(checkMessage('{count, plural, one {# RESULT} other {# RESULTS}}', ['count'])).toEqual([]);
    expect(checkMessage('Showing {shown, number} of {total}', ['shown', 'total'])).toEqual([]);
  });
  it('refuses a dropped variable and an invented one', () => {
    expect(checkMessage('No matches.', ['query'])).toEqual([{ code: 'missing_var', name: 'query' }]);
    expect(checkMessage('No matches for {qeury}.', ['query'])).toEqual([
      { code: 'missing_var', name: 'query' },
      { code: 'unknown_var', name: 'qeury' },
    ]);
  });
  it('refuses broken ICU and a plural without other', () => {
    expect(checkMessage('Thanks {name', ['name'])[0].code).toBe('syntax');
    expect(checkMessage('{count, plural, one {# RESULT}}', ['count'])[0].code).toBe('syntax');
    expect(checkMessage('{n, select, a {A} b {B}}', ['n'])[0].code).toBe('syntax');
  });
  it('finds variables nested inside plural branches', () => {
    expect(messageArgs('{count, plural, one {# table at {restaurant}} other {# tables}}')).toEqual(['count', 'restaurant']);
  });
  it('treats angle brackets as text (guest copy is React text, never markup)', () => {
    expect(checkMessage('Kids <12 eat free', [])).toEqual([]);
  });
  it('explains each problem in Vietnamese', () => {
    expect(describeProblem({ code: 'missing_var', name: 'phone' })).toContain('{phone}');
  });
});
