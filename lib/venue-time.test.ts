import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  formatDay,
  isValidIsoDate,
  minutesUntil,
  toMinutes,
  venueNow,
} from './venue-time';

describe('venueNow', () => {
  it('reads the date and time in Da Nang, not on the machine running the code', () => {
    // 17:30 UTC on 1 Oct is 00:30 on 2 Oct in Da Nang (UTC+7). The test runner is pinned to UTC.
    expect(venueNow(new Date('2026-10-01T17:30:00Z'))).toEqual({ date: '2026-10-02', minutes: 30 });
  });

  it('rolls over at Da Nang midnight', () => {
    expect(venueNow(new Date('2026-10-01T16:59:00Z'))).toEqual({ date: '2026-10-01', minutes: 23 * 60 + 59 });
    expect(venueNow(new Date('2026-10-01T17:00:00Z'))).toEqual({ date: '2026-10-02', minutes: 0 });
  });
});

describe('calendar maths', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-10-02', -1)).toBe('2026-10-01');
  });

  it('counts whole days between dates', () => {
    expect(daysBetween('2026-10-02', '2026-10-15')).toBe(13);
    expect(daysBetween('2026-10-02', '2026-10-01')).toBe(-1);
  });

  it('accepts only real YYYY-MM-DD dates', () => {
    expect(isValidIsoDate('2026-10-02')).toBe(true);
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('2026-10-2')).toBe(false);
    expect(isValidIsoDate('tomorrow')).toBe(false);
    expect(isValidIsoDate(20261002)).toBe(false);
  });

  it('reads HH:MM as minutes after midnight', () => {
    expect(toMinutes('19:30')).toBe(1170);
  });
});

describe('minutesUntil', () => {
  const at = new Date('2026-10-02T12:00:00Z'); // 19:00 in Da Nang

  it('measures from Da Nang time', () => {
    expect(minutesUntil('2026-10-02', '19:30', at)).toBe(30);
    expect(minutesUntil('2026-10-02', '18:00', at)).toBe(-60);
    expect(minutesUntil('2026-10-03', '07:00', at)).toBe(12 * 60);
  });
});

describe('formatDay', () => {
  it('formats the same way whatever timezone the browser is in', () => {
    expect(formatDay('2026-10-01')).toEqual({ weekday: 'Thu', day: '1', month: 'Oct', label: 'Thu, 1 Oct' });
    expect(formatDay('2026-09-03').month).toBe('Sep');
  });
});
