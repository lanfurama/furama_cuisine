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

  it('gives the party limit and the number to call, with defaults when the server sent none', () => {
    expect(bookingErrorMessage('party_too_large', { max: '8', phone: '0859 555 759' })).toBe(
      'For more than 8 guests, please call us on 0859 555 759.',
    );
    expect(bookingErrorMessage('party_too_large')).toBe('For more than 12 guests, please call us on +84 236 651 9999.');
  });

  it('says the restaurant is closed at that time (a whole day, or one meal), and that a sitting can no longer be booked for either clock rule', () => {
    expect(bookingErrorMessage('closed')).toBe('The restaurant is closed at that time — please choose another time or day.');
    expect(bookingErrorMessage('past')).toBe('That time can no longer be booked online — please choose a later time or another day.');
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
