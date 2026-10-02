import type { Meal } from '@/lib/data';
import type { IsoDate } from '@/lib/venue-time';

/*
 * The booking rules of one restaurant, as resolveDay reads them (spec §10.1).
 * No server-only import: the admin's slot preview runs the same engine in the
 * browser. The server loads these from the database in
 * lib/server/booking/rules.ts (booking_settings merged with the restaurant's
 * overrides, its active service periods, the closures that reach it).
 */

/** Statuses that hold covers (spec §10.3). One list for SQL, the engine and the admin. */
export const HOLDING_STATUSES = ['requested', 'confirmed', 'seated'] as const;

export const RESERVATION_STATUSES = ['requested', 'confirmed', 'seated', 'no_show', 'cancelled', 'declined'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/**
 * Spec §10.2 step 5 (R14): the active (requested or confirmed) web requests
 * one phone number may hold for one date, across every restaurant. The guest
 * form's error.too_many_requests names it as {limit}.
 */
export const PHONE_DAY_LIMIT = 3;

/** The gaps between seatings a service period may use (migration 006's CHECK on interval_min). */
export const SLOT_INTERVALS = [15, 20, 30, 45, 60, 90, 120] as const;

export type PeriodRule = {
  id: string;
  meal: Meal;
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  weekdays: number[];
  /** "HH:MM", Da Nang time. */
  firstSeating: string;
  lastSeating: string;
  intervalMin: number;
  coversPerSlot: number;
  sortOrder: number;
  /** Absent means active: the loader only returns active periods; the admin preview passes drafts. */
  active?: boolean;
};

export type ClosureRule = {
  id: string;
  scope: 'all' | 'destination' | 'restaurant';
  destinationId: string | null;
  restaurantId: string | null;
  startsOn: IsoDate;
  endsOn: IsoDate;
  /** null: the whole day. */
  meals: Meal[] | null;
  /** Already resolved for the guest's language, and null when show_reason is off. */
  publicReason: string | null;
};

export type BookingRules = {
  restaurantId: string;
  restaurantName: string;
  destinationId: string;
  bookingEnabled: boolean;
  windowDays: number;
  leadMinutes: number;
  /** "HH:MM" or null (no same-day cut-off). */
  sameDayCutoff: string | null;
  maxParty: number;
  autoConfirm: boolean;
  periods: PeriodRule[];
  closures: ClosureRule[];
};

/** The number guests call for a larger group (spec §10.2): a destination's phone until phase 6 adds restaurants.phone_*. */
export type GroupPhone = { display: string; tel: string };

/** Covers held per "HH:MM" on one date. */
export type BookedCovers = Record<string, number>;

/** Why a slot cannot take this party. */
export type SlotBlock = 'closed' | 'lead' | 'cutoff' | 'party' | 'full';

export type ResolvedSlot = {
  time: string;
  capacity: number;
  booked: number;
  /** Covers still free (never negative: staff bookings may go over). */
  left: number;
  bookable: boolean;
  block?: SlotBlock;
};

export type ResolvedPeriod = {
  periodId: string;
  meal: Meal;
  /** A closure takes out this meal on this date; its slots carry block 'closed'. */
  closed: boolean;
  reason: string | null;
  slots: ResolvedSlot[];
};

/**
 * - unavailable: online booking is off for the restaurant
 * - outside: before today or past the booking window
 * - closed: no service that weekday, or closures take out every service
 * - too_large: the party is larger than max_party
 * - past: every remaining sitting is inside the lead time or the same-day cut-off
 * - full: sittings remain, none with room for the party
 * - open: at least one bookable slot
 */
export type DayState = 'open' | 'full' | 'past' | 'closed' | 'too_large' | 'outside' | 'unavailable';

export type ResolvedDay = {
  date: IsoDate;
  state: DayState;
  /** The public closure reason, when a closure caused 'closed' and shows its reason. */
  reason: string | null;
  periods: ResolvedPeriod[];
};
