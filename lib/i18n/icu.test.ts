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
  it('finds variables nested inside plural branches, with their kind', () => {
    expect(messageArgs('{count, plural, one {# table at {restaurant}} other {# tables}}')).toEqual([
      { name: 'count', type: 'plural' },
      { name: 'restaurant', type: 'string' },
    ]);
    expect(messageArgs('{d, date} {t, time} {n, number} {s, select, a {A} other {B}} {o, selectordinal, other {#th}}')).toEqual([
      { name: 'd', type: 'date' },
      { name: 'n', type: 'number' },
      { name: 'o', type: 'selectordinal' },
      { name: 's', type: 'select' },
      { name: 't', type: 'time' },
    ]);
  });
  it('compares each shared variable’s kind with the English text’s (phase-7A ledger A3)', () => {
    const en = messageArgs('{count, plural, one {# guest} other {# guests}} at {restaurant}');
    expect(checkMessage('{count, plural, other {# khách}} tại {restaurant}', ['count', 'restaurant'], en)).toEqual([]);
    expect(checkMessage('{count} khách tại {restaurant}', ['count', 'restaurant'], en)).toEqual([
      { code: 'var_type', name: 'count', expected: 'plural', actual: 'string' },
    ]);
    expect(describeProblem({ code: 'var_type', name: 'count', expected: 'plural', actual: 'date' })).toBe(
      'Biến {count} phải dùng kiểu như bản tiếng Anh (số nhiều (plural)), không phải ngày.',
    );
  });
  it('reads a plain template’s apostrophes as characters, as formatMessage fills it (A3)', () => {
    expect(checkMessage("No results for '{query}'", ['query'])).toEqual([]);
    expect(messageArgs("It's {name}'s table")).toEqual([{ name: 'name', type: 'string' }]);
    // ICU syntax keeps ICU's quoting: '{' is a literal brace there.
    expect(messageArgs("{n, plural, other {# '{x}'}}")).toEqual([{ name: 'n', type: 'plural' }]);
  });
  it('treats angle brackets as text (guest copy is React text, never markup)', () => {
    expect(checkMessage('Kids <12 eat free', [])).toEqual([]);
  });
  it('explains each problem in Vietnamese', () => {
    expect(describeProblem({ code: 'missing_var', name: 'phone' })).toContain('{phone}');
  });
});
