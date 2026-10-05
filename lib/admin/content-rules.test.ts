import { describe, expect, it } from 'vitest';
import { charCount, checkLength, LIMITS, limitError, limitWarnings } from './content-rules';

describe('content rules (spec §6.5)', () => {
  it('counts characters as Postgres char_length does, not UTF-16 units', () => {
    expect(charCount('Tàya')).toBe(4);
    expect(charCount('🍜🍜')).toBe(2);
  });

  it('a nav label: up to 14 is fine, 15–18 warns, 19 is refused', () => {
    expect(checkLength('A'.repeat(14), 18, 14)).toEqual({ level: 'ok', count: 14 });
    expect(checkLength('A'.repeat(15), 18, 14)).toEqual({ level: 'warn', count: 15 });
    expect(checkLength('A'.repeat(18), 18, 14).level).toBe('warn');
    expect(checkLength('A'.repeat(19), 18, 14)).toEqual({ level: 'error', count: 19 });
  });

  it('holds the layout limits of spec §6.5', () => {
    expect(LIMITS).toMatchObject({
      heroSlides: { min: 1, max: 5 },
      destinations: { min: 2, max: 5 },
      stories: { max: 4 },
      offers: { max: 6, multipleOf: 3 },
      experiences: { min: 1, max: 5 },
      cuisines: { max: 10 },
      highlights: { max: 5, warnBelow: 2 },
      navItems: { max: 6 },
      socials: { max: 6 },
    });
  });

  it('refuses only above the maximum of shown items', () => {
    expect(limitError('offers', 6)).toBeNull();
    expect(limitError('offers', 7)).toMatch(/Tối đa 6/);
    expect(limitError('highlights', 5)).toBeNull();
    expect(limitError('highlights', 6)).toMatch(/Tối đa 5/);
    expect(limitError('heroSlides', 6)).toMatch(/Tối đa 5/);
    expect(limitError('navItems', 7)).toMatch(/Tối đa 6/);
  });

  it('warns about a count that is allowed but off the layout', () => {
    expect(limitWarnings('offers', 3)).toEqual([]);
    expect(limitWarnings('offers', 4)[0]).toMatch(/bội số của 3/);
    expect(limitWarnings('offers', 0)).toEqual([expect.stringMatching(/ẩn section Offers/)]);
    expect(limitWarnings('highlights', 1)).toEqual([expect.stringMatching(/ít nhất 2/)]);
    expect(limitWarnings('experiences', 0)[0]).toMatch(/ít nhất 1/);
  });
});
