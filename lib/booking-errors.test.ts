import { describe, expect, it } from 'vitest';
import { BOOKING_ERROR_CODES, DEFAULT_ERROR_STRINGS, bookingErrorMessage } from './booking-errors';

describe('bookingErrorMessage', () => {
  it('has guest-facing copy for every code', () => {
    for (const code of BOOKING_ERROR_CODES) {
      expect(bookingErrorMessage(code).length).toBeGreaterThan(10);
    }
  });

  it('names the restaurant when it does not serve the chosen time', () => {
    expect(bookingErrorMessage('slot_unavailable', { restaurant: 'Tàya House' })).toBe(
      'Tàya House does not serve at that time.',
    );
  });

  it('falls back to a generic subject when the restaurant is not given', () => {
    expect(bookingErrorMessage('slot_unavailable')).toBe('The restaurant does not serve at that time.');
  });
});

describe('bookingErrorMessage with resolved strings', () => {
  it('uses the override the server resolved, and still fills {restaurant}', () => {
    const strings = { ...DEFAULT_ERROR_STRINGS, 'error.slot_unavailable': 'Bàn ở {restaurant} đã kín giờ này.' };
    expect(bookingErrorMessage('slot_unavailable', { restaurant: 'Tàya House' }, strings)).toBe(
      'Bàn ở Tàya House đã kín giờ này.',
    );
  });
});
