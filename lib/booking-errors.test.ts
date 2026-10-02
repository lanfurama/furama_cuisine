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

  it('names the per-phone limit and the number to call, never accuses a refused bot (spec §10.2 steps 1 and 5)', () => {
    expect(bookingErrorMessage('too_many_requests', { phone: '0859 555 759' })).toBe(
      'This number already has 3 table requests for that day. To book more, please call us on 0859 555 759.',
    );
    expect(bookingErrorMessage('bot_blocked')).toBe('We could not accept this request online. Please call us on +84 236 651 9999 to book.');
    expect(bookingErrorMessage('consent_required')).toBe('Please tick the box to agree to how we use your details.');
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
