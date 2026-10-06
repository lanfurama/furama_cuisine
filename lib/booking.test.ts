import { describe, expect, it } from 'vitest';
import { FIELD_MAX, fold, validate, type BookingForm } from './booking';
import { parseReservationInput } from './server/booking/input';

describe('fold', () => {
  it('ignores accents and đ so guests can search without Vietnamese input', () => {
    expect(fold('Phố Cuốn')).toBe('pho cuon');
    expect(fold('Đà Nẵng')).toBe('da nang');
    expect(fold('Phở Bò Ưng')).toBe('pho bo ung');
  });

  it('compares Korean, Chinese and Japanese as written (R8-12), so a search finds what the card says', () => {
    expect(fold('한식 레스토랑')).toContain(fold('한식'));
    expect(fold('四川火锅')).toContain(fold('火锅'));
    expect(fold('ガーデン')).toContain(fold('ガー'));
    // Not split: a voiced kana stays one character, a Hangul syllable is not its jamo.
    expect(fold('ガ')).toBe('ガ');
    expect(fold('한')).toBe('한');
    // A decomposed syllable or kana (as some keyboards send them) is the composed one.
    expect(fold('\u1112\u1161\u11ab')).toBe('한');
    expect(fold('\u30ab\u3099')).toBe('ガ');
    expect(fold('Phở Cuốn')).toContain(fold('pho'));
  });
});

describe('validate', () => {
  it('needs a name of two letters, eight phone digits, and an email only when one is typed', () => {
    expect(validate({ name: 'An', phone: '0905 000 000', email: '', note: '' })).toEqual({ name: true, phone: true, email: true });
    expect(validate({ name: ' A ', phone: '1234 567', email: 'a@b', note: '' })).toEqual({ name: false, phone: false, email: false });
  });

  it('wants one "@" in an email, as the server does (R13)', () => {
    expect(validate({ name: 'An', phone: '0905 000 000', email: 'a@b@c.vn', note: '' }).email).toBe(false);
    expect(validate({ name: 'An', phone: '0905 000 000', email: 'an.nguyen@example.com.vn', note: '' }).email).toBe(true);
  });
});

describe('FIELD_MAX', () => {
  const form = { restaurant: 'taya-house', date: '2026-10-05', time: '19:00', guests: 2, name: 'An', phone: '0905 000 000', email: '', note: '', consent: true };
  // A valid value of exactly `n` characters for each field.
  const ofLength: Record<keyof BookingForm, (n: number) => string> = {
    name: (n) => 'a'.repeat(n),
    phone: (n) => `0905${' '.repeat(n - 11)}000 000`,
    email: (n) => `${'a'.repeat(n - 12)}@example.com`,
    note: (n) => 'a'.repeat(n),
  };

  it.each(Object.keys(ofLength) as (keyof BookingForm)[])('lets the drawer send the longest %s the server takes, and no longer', (field) => {
    const longest = ofLength[field](FIELD_MAX[field]);
    expect(longest).toHaveLength(FIELD_MAX[field]);
    expect(parseReservationInput({ ...form, [field]: longest })).toMatchObject({ ok: true });
    expect(parseReservationInput({ ...form, [field]: ofLength[field](FIELD_MAX[field] + 1) })).toMatchObject({ ok: false });
  });
});
