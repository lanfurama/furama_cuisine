import { describe, expect, it } from 'vitest';
import { FIELD_MAX, fold, validate, type BookingForm } from './booking';
import { parseReservationInput } from './server/booking/input';

describe('fold', () => {
  it('ignores accents and đ so guests can search without Vietnamese input', () => {
    expect(fold('Phố Cuốn')).toBe('pho cuon');
    expect(fold('Đà Nẵng')).toBe('da nang');
  });
});

describe('validate', () => {
  it('needs a name of two letters, eight phone digits, and an email only when one is typed', () => {
    expect(validate({ name: 'An', phone: '0905 000 000', email: '', note: '' })).toEqual({ name: true, phone: true, email: true });
    expect(validate({ name: ' A ', phone: '1234 567', email: 'a@b', note: '' })).toEqual({ name: false, phone: false, email: false });
  });
});

describe('FIELD_MAX', () => {
  const form = { restaurant: 'taya-house', date: '2026-10-05', time: '19:00', guests: 2, name: 'An', phone: '0905 000 000', email: '', note: '' };
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
