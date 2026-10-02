import { describe, expect, it } from 'vitest';
import { slotVerdict } from './slot-code';
import type { ResolvedDay } from './rules';

const day = (over: Partial<ResolvedDay> = {}): ResolvedDay => ({
  date: '2026-10-05',
  state: 'open',
  reason: null,
  periods: [
    {
      periodId: '1',
      meal: 'Dinner',
      closed: false,
      reason: null,
      slots: [
        { time: '18:00', capacity: 16, booked: 0, left: 16, bookable: true },
        { time: '18:30', capacity: 16, booked: 16, left: 0, bookable: false, block: 'full' },
        { time: '19:00', capacity: 16, booked: 0, left: 16, bookable: false, block: 'lead' },
        { time: '19:30', capacity: 16, booked: 0, left: 16, bookable: false, block: 'cutoff' },
        { time: '20:00', capacity: 16, booked: 0, left: 16, bookable: false, block: 'closed' },
      ],
    },
  ],
  ...over,
});

const code = (d: ResolvedDay, time: string) => {
  const v = slotVerdict(d, time);
  return v.ok ? `ok:${v.period.meal}` : v.code;
};

describe('slotVerdict', () => {
  it('maps a slot to the guest error codes', () => {
    expect(['18:00', '18:30', '19:00', '19:30', '20:00', '15:00'].map((t) => code(day(), t))).toEqual([
      'ok:Dinner', 'full', 'past', 'past', 'closed', 'slot_unavailable',
    ]);
  });

  it('lets the day state speak first', () => {
    expect(code(day({ state: 'unavailable' }), '18:00')).toBe('restaurant_unavailable');
    expect(code(day({ state: 'outside' }), '18:00')).toBe('outside_window');
    expect(code(day({ state: 'too_large' }), '18:00')).toBe('party_too_large');
  });

  it('answers closed for any time on a day with no service', () => {
    expect(code(day({ state: 'closed', periods: [] }), '18:00')).toBe('closed');
  });
});
