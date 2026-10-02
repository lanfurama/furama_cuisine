import type { ReservationStatus } from '@/lib/booking/rules';
import { addDays, minutesUntil, venueNow, type IsoDate } from '@/lib/venue-time';

/*
 * The reservation lifecycle of spec §10.3, in one map. The data layer
 * (lib/server/booking/reservations.ts) enforces it; the admin screens read it
 * to show only the buttons that can work. No server-only import: client
 * components use the labels too. The statuses themselves, and which of them
 * hold covers, live in lib/booking/rules.ts.
 */

/** Still to come and still expected: what "affected by a closure or new hours" looks at. */
export const UPCOMING_STATUSES = ['requested', 'confirmed'] as const satisfies readonly ReservationStatus[];

export const STATUS_LABELS: Record<ReservationStatus, string> = {
  requested: 'Chờ xác nhận',
  confirmed: 'Đã xác nhận',
  seated: 'Đã đến',
  no_show: 'Không đến',
  cancelled: 'Đã hủy',
  declined: 'Đã từ chối',
};

/** The guest emails of spec §10.4 a transition may trigger. Phase 5 queues them; phase 4 only names them. */
export type GuestEmailEvent = 'guest.confirmed' | 'guest.declined' | 'guest.cancelled';

/** When a transition may run, relative to the sitting (reserved_on + reserved_at, Vietnam time). */
export type TimeWindow =
  | { kind: 'any' }
  /** From `minutes` before the sitting onward ("Đã đến" from 60 minutes before). */
  | { kind: 'from_before'; minutes: number }
  /** Only once `minutes` have passed since the sitting (no-show 15 minutes after). */
  | { kind: 'after'; minutes: number }
  /** Corrections: only while the service day of the sitting lasts (see serviceDay). */
  | { kind: 'same_service_day' };

export type Transition = {
  from: ReservationStatus;
  to: ReservationStatus;
  window: TimeWindow;
  /** Decline and cancel carry a reason (stored in status_reason; the guest reads it from phase 5). */
  reason: 'required' | 'optional';
  /**
   * The guest email this transition queues in its own transaction from phase 5:
   * `always` (when the guest gave an email) or only when staff tick "Báo khách".
   */
  guestEmail: { event: GuestEmailEvent; when: 'always' | 'if_notify' } | null;
  /** Button text on the detail screen. */
  label: string;
};

const ANY: TimeWindow = { kind: 'any' };
const CORRECTION: TimeWindow = { kind: 'same_service_day' };
const CANCEL = { reason: 'required', guestEmail: { event: 'guest.cancelled', when: 'if_notify' }, label: 'Hủy' } as const;

/** Every allowed change. Who: Editor and Admin alike (permission reservations:update). */
export const TRANSITIONS: readonly Transition[] = [
  { from: 'requested', to: 'confirmed', window: ANY, reason: 'optional', guestEmail: { event: 'guest.confirmed', when: 'always' }, label: 'Xác nhận' },
  { from: 'requested', to: 'declined', window: ANY, reason: 'required', guestEmail: { event: 'guest.declined', when: 'always' }, label: 'Từ chối' },
  { from: 'requested', to: 'cancelled', window: ANY, ...CANCEL },
  { from: 'confirmed', to: 'cancelled', window: ANY, ...CANCEL },
  { from: 'confirmed', to: 'seated', window: { kind: 'from_before', minutes: 60 }, reason: 'optional', guestEmail: null, label: 'Đã đến' },
  { from: 'confirmed', to: 'no_show', window: { kind: 'after', minutes: 15 }, reason: 'optional', guestEmail: null, label: 'Không đến' },
  // The guest is physically there: seats are held again without a capacity check (R9).
  { from: 'no_show', to: 'seated', window: CORRECTION, reason: 'optional', guestEmail: null, label: 'Sửa: khách đã đến' },
  { from: 'seated', to: 'confirmed', window: CORRECTION, reason: 'optional', guestEmail: null, label: 'Sửa: chưa đến' },
];

export function findTransition(from: ReservationStatus, to: ReservationStatus): Transition | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to);
}

export function transitionsFrom(from: ReservationStatus): Transition[] {
  return TRANSITIONS.filter((t) => t.from === from);
}

/** Every status that may move to `to` (the `status = ANY($from)` of the UPDATE). */
export function sourcesOf(to: ReservationStatus): ReservationStatus[] {
  return TRANSITIONS.filter((t) => t.to === to).map((t) => t.from);
}

/** Bookings made by staff start further along (spec §10.3): a phone booking is confirmed, a walk-in already seated. */
export const STAFF_SOURCES = { phone: 'confirmed', walk_in: 'seated' } as const satisfies Record<string, ReservationStatus>;
export type StaffSource = keyof typeof STAFF_SOURCES;

export const SOURCE_LABELS: Record<string, string> = {
  web: 'Web',
  phone: 'Điện thoại',
  walk_in: 'Khách vãng lai',
  staff: 'Nhân viên',
  legacy: 'Dữ liệu cũ',
};

/** A service day runs until 04:00 the next morning, so a late-night correction still counts for its evening. */
export const SERVICE_DAY_ROLLOVER_MINUTES = 4 * 60;

/** The service day an instant falls in, as YYYY-MM-DD (Vietnam time, 04:00 rollover). */
export function serviceDay(now: Date = new Date()): IsoDate {
  const v = venueNow(now);
  return v.minutes < SERVICE_DAY_ROLLOVER_MINUTES ? addDays(v.date, -1) : v.date;
}

export type WindowCheck = { ok: true } | { ok: false; code: 'too_early' | 'too_late' };

/** Whether `t` may run now for a sitting at `time` on `date`. */
export function checkWindow(t: Transition, date: IsoDate, time: string, now: Date = new Date()): WindowCheck {
  const until = minutesUntil(date, time, now);
  switch (t.window.kind) {
    case 'any':
      return { ok: true };
    case 'from_before':
      return until <= t.window.minutes ? { ok: true } : { ok: false, code: 'too_early' };
    case 'after':
      return until <= -t.window.minutes ? { ok: true } : { ok: false, code: 'too_early' };
    case 'same_service_day': {
      const today = serviceDay(now);
      if (date === today) return { ok: true };
      return date > today ? { ok: false, code: 'too_early' } : { ok: false, code: 'too_late' };
    }
  }
}

/**
 * The minute of the sitting's day (Vietnam time) a windowed transition opens,
 * for the "Từ 18:00" hint; null for a window without such a start.
 */
export function opensAtMinutes(t: Transition, time: string): number | null {
  const sitting = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  if (t.window.kind === 'from_before') return sitting - t.window.minutes;
  if (t.window.kind === 'after') return sitting + t.window.minutes;
  return null;
}

/**
 * The transitions a booking offers right now, each with whether its window is
 * open. A server page calls it without `now` (React's purity rule keeps
 * `new Date()` out of component bodies).
 */
export function availableTransitions(
  status: ReservationStatus,
  date: IsoDate,
  time: string,
  now: Date = new Date(),
): { transition: Transition; window: WindowCheck }[] {
  return transitionsFrom(status).map((transition) => ({ transition, window: checkWindow(transition, date, time, now) }));
}
