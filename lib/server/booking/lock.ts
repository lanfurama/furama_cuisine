import 'server-only';
import type { PoolClient } from 'pg';
import type { IsoDate } from '@/lib/venue-time';

/*
 * The one booking-day lock (spec §10.2 step 6). Every write that takes covers
 * (guest submit, staff create, an edit that moves or grows a booking) calls
 * this first, on the client of its transaction, and only then reads the rules
 * and the covers. One key for every path, or guest and staff writes would
 * never wait for each other. At most one booking-day lock per transaction.
 */
export async function lockBookingDay(
  client: PoolClient,
  restaurantId: string,
  date: IsoDate,
  { timeout = '5s' }: { timeout?: string } = {},
): Promise<void> {
  // A stuck holder must not queue a whole day (and the pool's 5 connections)
  // forever: give up with 55P03, which reaches the guest as error.network.
  // set_config(…, true) is SET LOCAL with a bind parameter.
  await client.query(`SELECT set_config('lock_timeout', $1, true)`, [timeout]);
  // hashtextextended → bigint, the key space of pg_advisory_xact_lock; released at COMMIT or ROLLBACK.
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('booking:' || $1 || ':' || $2, 0))`, [restaurantId, date]);
}
