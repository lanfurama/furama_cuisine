import type { Meal } from '@/lib/data';
import type { IsoDate } from '@/lib/venue-time';
import type { DayState, GroupPhone, SlotBlock } from './rules';

/*
 * The contract of GET /api/availability (spec §10.2; ruling R4 of the phase-4
 * plan), shared by the route and the guest form. Both forms echo the
 * restaurant, so the browser can drop an answer meant for another one, and
 * carry the server's clock: `now` is an ISO instant (the phase-1 deviation
 * from nowMinutes noted in spec §10.2).
 */

/** The longest from..to span the calendar form answers. */
export const MAX_RANGE_DAYS = 92;

/** One date of the strip, for a party of one. `reason` is the public closure reason. */
export type DayInfo = { date: IsoDate; state: DayState; reason?: string };

/** ?restaurant=&lang=[&from=&to=]: from and to default to the booking window. */
export type CalendarResponse = {
  restaurant: string;
  today: IsoDate;
  now: string;
  maxParty: number;
  groupPhone: GroupPhone | null;
  days: DayInfo[];
};

export type SlotInfo = { time: string; left: number; bookable: boolean; block?: SlotBlock };

/** A closed period keeps its heading and reason, with no slots. */
export type PeriodInfo = { meal: Meal; closed: boolean; reason?: string; slots: SlotInfo[] };

/** ?restaurant=&date=&lang=[&guests=]: guests defaults to 1. */
export type DayResponse = {
  restaurant: string;
  today: IsoDate;
  now: string;
  date: IsoDate;
  state: DayState;
  reason?: string;
  maxParty: number;
  /** The clock rules, so the open form closes sittings itself (clockBlock). */
  leadMinutes: number;
  sameDayCutoff: string | null;
  periods: PeriodInfo[];
};

/** 400: restaurant_required, invalid_date, invalid_range, invalid_guests; 404: restaurant_unavailable; 503: unavailable. */
export type AvailabilityErrorCode =
  | 'restaurant_required'
  | 'invalid_date'
  | 'invalid_range'
  | 'invalid_guests'
  | 'restaurant_unavailable'
  | 'unavailable';

export type AvailabilityError = { error: AvailabilityErrorCode };
