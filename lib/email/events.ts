import type { ReservationStatus } from '@/lib/booking/rules';

/*
 * The booking email events of spec §10.4: one set of names for
 * email_outbox.event, notification_recipients.events[] and the registry keys
 * email.<event>.<field>. No server-only import: the admin's client components
 * show the labels too. Migration 007's CHECKs list the same names and
 * statuses; test/integration/migration-007.test.ts holds the two together.
 */
export const STAFF_EMAIL_EVENTS = ['staff.new'] as const;
export const GUEST_EMAIL_EVENTS = ['guest.ack', 'guest.confirmed', 'guest.declined', 'guest.cancelled'] as const;
export const EMAIL_EVENTS = [...STAFF_EMAIL_EVENTS, ...GUEST_EMAIL_EVENTS] as const;

export type StaffEmailEventName = (typeof STAFF_EMAIL_EVENTS)[number];
export type GuestEmailEventName = (typeof GUEST_EMAIL_EVENTS)[number];
export type EmailEvent = (typeof EMAIL_EVENTS)[number];
export type EmailAudience = 'staff' | 'guest';

export function isEmailEvent(value: unknown): value is EmailEvent {
  return typeof value === 'string' && (EMAIL_EVENTS as readonly string[]).includes(value);
}

export const audienceOf = (event: EmailEvent): EmailAudience => (event.startsWith('staff.') ? 'staff' : 'guest');

/** Admin labels (Vietnamese, spec §7.3). */
export const EMAIL_EVENT_LABELS: Record<EmailEvent, string> = {
  'staff.new': 'Báo nhân viên: đặt bàn mới',
  'guest.ack': 'Khách: đã nhận yêu cầu',
  'guest.confirmed': 'Khách: đã xác nhận',
  'guest.declined': 'Khách: bị từ chối',
  'guest.cancelled': 'Khách: đã hủy',
};

/** email_outbox.status. 'sending' is a claimed row under its lease (lib/server/email/drain.ts). */
export const EMAIL_STATUSES = ['queued', 'sending', 'sent', 'skipped', 'failed'] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const EMAIL_STATUS_LABELS: Record<EmailStatus, string> = {
  queued: 'Đang chờ gửi',
  sending: 'Đang gửi',
  sent: 'Đã gửi',
  skipped: 'Bỏ qua',
  failed: 'Lỗi',
};

/** "lan.nguyen@gmail.com" → "l•••@gmail.com": enough to tell two guests apart on a list, not to copy the address. */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf('@');
  if (at <= 0) return '•••';
  return `${address[0]}•••${address.slice(at)}`;
}

/**
 * The booking statuses under which an event's email is still true when the
 * sender picks the row up (spec §10.4: "đọc lại đặt bàn … không còn khớp thì
 * đánh dấu skipped", R7). A request confirmed before its guest.ack went out
 * skips the ack; a confirmation still queued when staff cancel is never sent.
 * guest.confirmed is for confirmed bookings only: a walk-in is already at the
 * table (R8).
 */
export const EVENT_STATUSES: Record<EmailEvent, readonly ReservationStatus[]> = {
  'staff.new': ['requested', 'confirmed', 'seated'],
  'guest.ack': ['requested'],
  'guest.confirmed': ['confirmed'],
  'guest.declined': ['declined'],
  'guest.cancelled': ['cancelled'],
};
