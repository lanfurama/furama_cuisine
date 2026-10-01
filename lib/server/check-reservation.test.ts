import { describe, expect, it } from 'vitest';
import type { Restaurant } from '@/lib/data';
import { checkReservation, type ReservationInput } from './check-reservation';

const taya: Restaurant = {
  id: 'taya-house',
  name: 'Tàya House',
  type: 'Vietnamese · Cooking Class',
  cuisines: ['Vietnamese'],
  dest: 'resort',
  meals: ['Lunch', 'Dinner'],
  slotCapacity: 16,
};

const input = (over: Partial<ReservationInput> = {}): ReservationInput => ({
  restaurant: 'taya-house',
  date: '2026-10-02',
  time: '19:00',
  guests: 2,
  name: 'Nguyễn Minh Anh',
  phone: '0905 000 000',
  email: '',
  note: '',
  ...over,
});

const at1am = new Date('2026-10-01T18:00:00Z'); // 01:00 on 2 Oct in Da Nang; still 1 Oct on a UTC server
const at7pm = new Date('2026-10-02T12:00:00Z'); // 19:00 on 2 Oct in Da Nang

const codeOf = (over: Partial<ReservationInput>, now = at1am) => {
  const result = checkReservation(input(over), [taya], now);
  return result.ok ? 'ok' : result.code;
};

describe('checkReservation: dates in Da Nang time', () => {
  it('books the date the guest picked, even between midnight and 07:00 in Da Nang', () => {
    const result = checkReservation(input(), [taya], at1am);
    expect(result).toMatchObject({ ok: true, value: { date: '2026-10-02', phoneE164: '+84905000000' } });
  });

  it('treats the UTC server date as yesterday, not today', () => {
    expect(codeOf({ date: '2026-10-01' })).toBe('outside_window');
  });

  it('accepts the last day of the window and refuses the day after', () => {
    expect(codeOf({ date: '2026-10-15' })).toBe('ok');
    expect(codeOf({ date: '2026-10-16' })).toBe('outside_window');
  });

  it('closes sittings by Da Nang time, 30 minutes ahead', () => {
    expect(codeOf({ time: '19:00' }, at7pm)).toBe('past');
    expect(codeOf({ time: '19:30' }, at7pm)).toBe('past');
    expect(codeOf({ time: '20:00' }, at7pm)).toBe('ok');
  });
});

describe('checkReservation: tampered or invalid input', () => {
  it.each([
    [{ restaurant: 'nowhere' }, 'restaurant_unavailable'],
    [{ guests: 13 }, 'party_too_large'],
    [{ guests: 0 }, 'unknown'],
    [{ guests: 2.5 }, 'unknown'],
    [{ date: 'tomorrow' }, 'outside_window'],
    [{ date: '2026-02-30' }, 'outside_window'],
    [{ time: '19:15' }, 'slot_unavailable'],
    [{ time: '08:00' }, 'slot_unavailable'],
    [{ name: ' a ' }, 'invalid_name'],
    [{ phone: '12345' }, 'invalid_phone'],
    [{ email: 'guest@' }, 'invalid_email'],
  ] as [Partial<ReservationInput>, string][])('%j → %s', (over, code) => {
    expect(codeOf(over)).toBe(code);
  });

  it('names the restaurant when it does not serve the time', () => {
    expect(checkReservation(input({ time: '08:00' }), [taya], at1am)).toEqual({
      ok: false,
      code: 'slot_unavailable',
      params: { restaurant: 'Tàya House' },
    });
  });

  it('accepts foreign numbers', () => {
    expect(checkReservation(input({ phone: '+33 6 12 34 56 78' }), [taya], at1am)).toMatchObject({
      ok: true,
      value: { phoneE164: '+33612345678' },
    });
  });

  it('trims what it stores and drops empty optional fields', () => {
    const result = checkReservation(input({ name: '  An  ', email: '  ', note: '  ' }), [taya], at1am);
    expect(result).toMatchObject({ ok: true, value: { name: 'An', email: undefined, note: undefined } });
  });
});
