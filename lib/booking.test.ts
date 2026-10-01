import { describe, expect, it } from 'vitest';
import type { Restaurant } from './data';
import {
  NO_AVAILABILITY,
  bookingDates,
  defaultDate,
  fold,
  inWindow,
  isSittingClosed,
  reconcile,
  unavailable,
  type Booking,
} from './booking';

describe('fold', () => {
  it('ignores accents and đ so guests can search without Vietnamese input', () => {
    expect(fold('Phố Cuốn')).toBe('pho cuon');
    expect(fold('Đà Nẵng')).toBe('da nang');
  });
});

const taya: Restaurant = {
  id: 'taya-house',
  slug: 'taya-house',
  hasDetailPage: true,
  name: 'Tàya House',
  type: 'Vietnamese · Cooking Class',
  cuisines: ['vietnamese'],
  dest: 'resort',
  meals: ['Lunch', 'Dinner'],
  slotCapacity: 16,
};

describe('booking window', () => {
  it('offers 14 dates starting today', () => {
    const dates = bookingDates('2026-10-02');
    expect(dates).toHaveLength(14);
    expect(dates[0]).toBe('2026-10-02');
    expect(dates[13]).toBe('2026-10-15');
  });

  it('runs from today to 13 days after it', () => {
    expect(inWindow('2026-10-02', '2026-10-02')).toBe(true);
    expect(inWindow('2026-10-15', '2026-10-02')).toBe(true);
    expect(inWindow('2026-10-16', '2026-10-02')).toBe(false);
    expect(inWindow('2026-10-01', '2026-10-02')).toBe(false);
  });
});

describe('isSittingClosed', () => {
  const at = new Date('2026-10-02T12:00:00Z'); // 19:00 in Da Nang

  it('closes a sitting 30 minutes before it starts', () => {
    expect(isSittingClosed('2026-10-02', '19:30', at)).toBe(true);
    expect(isSittingClosed('2026-10-02', '20:00', at)).toBe(false);
  });

  it("leaves tomorrow's sittings open", () => {
    expect(isSittingClosed('2026-10-03', '07:00', at)).toBe(false);
  });
});

describe('defaultDate', () => {
  it('keeps today while a sitting is still open', () => {
    expect(defaultDate([taya], 'taya-house', '2026-10-02', new Date('2026-10-02T12:00:00Z'))).toBe('2026-10-02');
  });

  it('moves to tomorrow once the last sitting has closed', () => {
    // 20:45 in Da Nang: the 21:00 sitting is 15 minutes away, inside the 30-minute lead.
    expect(defaultDate([taya], 'taya-house', '2026-10-02', new Date('2026-10-02T13:45:00Z'))).toBe('2026-10-03');
  });
});

describe('the slot board', () => {
  const noon = new Date('2026-10-02T05:00:00Z'); // 12:00 in Da Nang
  const chosen: Booking = { destination: 'resort', restaurant: 'taya-house', date: '2026-10-02', time: '19:00', guests: 4 };

  it('treats every slot as closed until the date is known', () => {
    expect(unavailable('', '19:00', 2, NO_AVAILABILITY, noon)).toBe(true);
  });

  it('moves the chosen time to the nearest slot that still fits once it fills', () => {
    const board = { booked: { '19:00': 14 }, capacity: 16 };
    expect(reconcile([taya], chosen, {}, board, noon).time).toBe('18:30');
  });

  it('keeps the chosen time while the party still fits', () => {
    const board = { booked: { '19:00': 12 }, capacity: 16 };
    expect(reconcile([taya], chosen, {}, board, noon).time).toBe('19:00');
  });
});
