import { describe, expect, it } from 'vitest';
import { fold, validate } from './booking';

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
