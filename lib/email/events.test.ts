import { describe, expect, it } from 'vitest';
import { RESERVATION_STATUSES } from '@/lib/booking/rules';
import {
  EMAIL_EVENTS,
  EMAIL_EVENT_LABELS,
  EMAIL_STATUSES,
  EMAIL_STATUS_LABELS,
  EVENT_STATUSES,
  GUEST_EMAIL_EVENTS,
  STAFF_EMAIL_EVENTS,
  audienceOf,
  isEmailEvent,
  maskEmail,
} from './events';

describe('booking email events (spec §10.4)', () => {
  it('one set of names: staff.new and the four guest emails', () => {
    expect(EMAIL_EVENTS).toEqual(['staff.new', 'guest.ack', 'guest.confirmed', 'guest.declined', 'guest.cancelled']);
    expect([...STAFF_EMAIL_EVENTS, ...GUEST_EMAIL_EVENTS]).toEqual([...EMAIL_EVENTS]);
    expect(EMAIL_EVENTS.map(audienceOf)).toEqual(['staff', 'guest', 'guest', 'guest', 'guest']);
    expect(isEmailEvent('guest.ack')).toBe(true);
    expect(isEmailEvent('staff.test')).toBe(false);
    expect(isEmailEvent(42)).toBe(false);
  });

  it('every event and status has a Vietnamese label', () => {
    expect(Object.keys(EMAIL_EVENT_LABELS)).toEqual([...EMAIL_EVENTS]);
    expect(EMAIL_STATUSES).toEqual(['queued', 'sending', 'sent', 'skipped', 'failed']);
    expect(Object.keys(EMAIL_STATUS_LABELS)).toEqual([...EMAIL_STATUSES]);
    expect(EMAIL_STATUS_LABELS.sending).toBe('Đang gửi');
  });

  it('sends an email only while the booking still says what it says (R7)', () => {
    expect(EVENT_STATUSES).toEqual({
      'staff.new': ['requested', 'confirmed', 'seated'],
      'guest.ack': ['requested'],
      // A walk-in never gets one (R8): seated is not a confirmation.
      'guest.confirmed': ['confirmed'],
      'guest.declined': ['declined'],
      'guest.cancelled': ['cancelled'],
    });
    for (const statuses of Object.values(EVENT_STATUSES)) {
      for (const s of statuses) expect(RESERVATION_STATUSES).toContain(s);
    }
  });

  it('masks a guest address down to its first letter and domain', () => {
    expect(maskEmail('lan.nguyen@gmail.com')).toBe('l•••@gmail.com');
    expect(maskEmail('a@b.vn')).toBe('a•••@b.vn');
    expect(maskEmail('odd@home@example.com')).toBe('o•••@example.com');
    expect(maskEmail('nobody')).toBe('•••');
    expect(maskEmail('@x.vn')).toBe('•••');
  });
});
