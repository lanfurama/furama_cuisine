import 'server-only';
import type { PoolClient } from 'pg';
import type { IsoDate } from '@/lib/venue-time';

/*
 * The transaction-scoped advisory locks of the booking paths, and the only
 * place that calls pg_advisory_xact_lock. Both are released at COMMIT or
 * ROLLBACK and both give up after lock_timeout with 55P03, which reaches the
 * guest as error.network: a stuck holder must not queue a whole day (and the
 * pool's 5 connections) forever.
 *
 * Lock order, so two transactions can never wait on each other in a circle:
 * a guest submit takes its phone lock first, then the booking-day lock; every
 * other path takes the booking-day lock only. At most one lock of each kind
 * per transaction.
 */

type LockOptions = { timeout?: string };

async function advisoryLock(client: PoolClient, key: string, { timeout = '5s' }: LockOptions): Promise<void> {
  // set_config(…, true) is SET LOCAL with a bind parameter.
  await client.query(`SELECT set_config('lock_timeout', $1, true)`, [timeout]);
  // hashtextextended → bigint, the key space of pg_advisory_xact_lock.
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [key]);
}

/**
 * The one booking-day lock (spec §10.2 step 6). Every write that takes covers
 * (guest submit, staff create, an edit that moves or grows a booking) calls
 * this first, on the client of its transaction, and only then reads the rules
 * and the covers. One key for every path, or guest and staff writes would
 * never wait for each other.
 */
export function lockBookingDay(client: PoolClient, restaurantId: string, date: IsoDate, options: LockOptions = {}): Promise<void> {
  return advisoryLock(client, `booking:${restaurantId}:${date}`, options);
}

/**
 * The guest phone limit's lock (spec §10.2 step 5, R14): one guest number on
 * one date, across every restaurant. The booking-day lock cannot serialise
 * the count, because the same number may book two restaurants at once.
 */
export function lockGuestPhoneDay(client: PoolClient, phoneE164: string, date: IsoDate, options: LockOptions = {}): Promise<void> {
  return advisoryLock(client, `guest-phone:${phoneE164}:${date}`, options);
}
