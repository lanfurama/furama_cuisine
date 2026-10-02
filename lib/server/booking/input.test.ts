import { describe, expect, it } from 'vitest';
import { parseReservationInput } from './input';

const valid = {
  restaurant: 'taya-house',
  date: '2026-10-05',
  time: '19:00',
  guests: 2,
  name: '  Nguyễn Minh Anh ',
  phone: '0905 000 000',
  email: '',
  note: ' window seat ',
};

describe('parseReservationInput', () => {
  it('trims, normalises the phone and defaults the locale', () => {
    expect(parseReservationInput(valid)).toEqual({
      ok: true,
      value: {
        restaurantId: 'taya-house',
        date: '2026-10-05',
        time: '19:00',
        guests: 2,
        name: 'Nguyễn Minh Anh',
        phone: '0905 000 000',
        phoneE164: '+84905000000',
        email: null,
        note: 'window seat',
        locale: 'en',
      },
    });
  });

  it.each([
    [{ restaurant: '' }, 'restaurant_unavailable'],
    [{ date: '2026-02-30' }, 'outside_window'],
    [{ date: '05/10/2026' }, 'outside_window'],
    [{ time: '19:5' }, 'slot_unavailable'],
    [{ guests: '2' }, 'unknown'],
    [{ guests: 0 }, 'unknown'],
    [{ name: 'A' }, 'invalid_name'],
    [{ phone: '12 34' }, 'invalid_phone'],
    [{ phone: '0000 0000 00' }, 'invalid_phone'],
    [{ email: 'a@b' }, 'invalid_email'],
    [{ note: 'x'.repeat(1001) }, 'unknown'],
    [{ locale: 'x'.repeat(36) }, 'unknown'],
  ])('%j → %s', (over, code) => {
    expect(parseReservationInput({ ...valid, ...over })).toEqual({ ok: false, code });
  });

  it('reports the first bad field in form order', () => {
    expect(parseReservationInput({ ...valid, name: '', phone: '', email: 'x' })).toEqual({ ok: false, code: 'invalid_name' });
  });

  it('leaves a large party to max_party (no upper bound here)', () => {
    expect(parseReservationInput({ ...valid, guests: 40 })).toMatchObject({ ok: true, value: { guests: 40 } });
  });

  it('refuses anything that is not the form object', () => {
    expect(parseReservationInput(null)).toEqual({ ok: false, code: 'unknown' });
    expect(parseReservationInput('taya-house')).toEqual({ ok: false, code: 'unknown' });
  });
});
