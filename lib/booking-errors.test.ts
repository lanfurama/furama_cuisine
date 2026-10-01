import { describe, expect, it } from 'vitest';
import { BOOKING_ERROR_CODES, bookingErrorMessage } from './booking-errors';

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
