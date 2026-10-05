import { describe, expect, it } from 'vitest';
import type { EmailEvent } from '@/lib/email/events';
import type { BookingEmailData } from './booking/load';
import { staleReason, type ClaimedRow } from './drain';

/*
 * staleReason (R7, triage ruling 1 of the phase-5 final fix wave): no booking
 * email goes out once its sitting has started, measured on Da Nang's clock
 * (lib/venue-time.ts minutesUntil). Every `now` below is written with its
 * +07:00 offset, so the server's own timezone (UTC under npm test) cannot move it.
 */

const row = (event: EmailEvent = 'guest.confirmed'): ClaimedRow => ({
  id: '1',
  event,
  reservation_id: '42',
  to_email: 'anh.nguyen@guest.vn',
  locale: 'en',
  attempts: 1,
  idempotency_key: 'outbox:1',
  message_id: null,
  fallback: false,
  reservation_event_id: null,
});

const booking = (over: Partial<BookingEmailData> = {}): BookingEmailData => ({
  reservationId: '42',
  reference: 'FC-7K3QH9XA',
  restaurantName: 'Tàya House',
  date: '2026-10-05',
  time: '19:00',
  guests: 2,
  status: 'confirmed',
  statusReason: null,
  guestName: 'Nguyễn Thị Ánh',
  phone: '0905 123 456',
  email: 'anh.nguyen@guest.vn',
  note: null,
  offerTitle: null,
  groupPhone: null,
  anonymized: false,
  ...over,
});

/** A moment on Da Nang's clock. */
const danang = (local: string) => new Date(`${local}+07:00`);

describe('staleReason: the sitting', () => {
  it.each([
    ['one minute before the sitting', '2026-10-05T18:59:00', null],
    ['at the sitting minute', '2026-10-05T19:00:00', null],
    ['late in the sitting minute', '2026-10-05T19:00:59', null],
    ['one minute after', '2026-10-05T19:01:00', 'skipped: the sitting has passed'],
    ['the next morning', '2026-10-06T08:00:00', 'skipped: the sitting has passed'],
  ])('a confirmation %s → %s', (_when, local, expected) => {
    expect(staleReason(row(), booking(), danang(local))).toBe(expected);
  });

  it.each([
    ['staff.new', 'requested'],
    ['guest.ack', 'requested'],
    ['guest.confirmed', 'confirmed'],
    ['guest.declined', 'declined'],
    ['guest.cancelled', 'cancelled'],
  ] as const)('%s is skipped once the sitting has passed, like every booking email', (event, status) => {
    expect(staleReason(row(event), booking({ status }), danang('2026-10-05T18:59:00'))).toBeNull();
    expect(staleReason(row(event), booking({ status }), danang('2026-10-05T19:01:00'))).toBe('skipped: the sitting has passed');
  });

  it('a booking that changed status says so first: the status is the reason staff can act on', () => {
    expect(staleReason(row('guest.confirmed'), booking({ status: 'cancelled' }), danang('2026-10-06T08:00:00'))).toBe('skipped: the booking is now cancelled');
  });

  it('a sitting just after midnight belongs to its own date, not the evening before', () => {
    const late = booking({ date: '2026-10-06', time: '00:30' });
    expect(staleReason(row(), late, danang('2026-10-05T23:59:00'))).toBeNull();
    expect(staleReason(row(), late, danang('2026-10-06T00:31:00'))).toBe('skipped: the sitting has passed');
  });
});
