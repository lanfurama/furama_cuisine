import type { BookingErrorCode } from '@/lib/booking-errors';
import { findSlot } from './resolve-day';
import type { DayState, ResolvedDay, ResolvedPeriod, SlotBlock } from './rules';

/*
 * Whether a party can have `time` on a resolved day, and if not, why, as the
 * guest error codes of spec §10.2. submitReservation answers with these.
 */

const DAY_CODES: Partial<Record<DayState, BookingErrorCode>> = {
  unavailable: 'restaurant_unavailable',
  outside: 'outside_window',
  too_large: 'party_too_large',
};

const SLOT_CODES: Record<SlotBlock, BookingErrorCode> = {
  closed: 'closed',
  lead: 'past',
  cutoff: 'past',
  party: 'party_too_large',
  full: 'full',
};

export type SlotVerdict =
  | { ok: true; period: ResolvedPeriod }
  | { ok: false; code: BookingErrorCode };

export function slotVerdict(day: ResolvedDay, time: string): SlotVerdict {
  const dayCode = DAY_CODES[day.state];
  if (dayCode) return { ok: false, code: dayCode };
  const hit = findSlot(day, time);
  if (!hit) return { ok: false, code: day.state === 'closed' ? 'closed' : 'slot_unavailable' };
  if (hit.slot.block) return { ok: false, code: SLOT_CODES[hit.slot.block] };
  return { ok: true, period: hit.period };
}
