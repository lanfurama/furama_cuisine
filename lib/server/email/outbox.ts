import 'server-only';
import type { PoolClient } from 'pg';
import type { GuestEmailEventName } from '@/lib/email/events';
import type { ReservationEffects } from '@/lib/server/booking/reservations';
import { outboxEnv, type OutboxEnv } from './env';
import { reachesSql } from './recipients';

/*
 * Writing email_outbox rows (spec §10.4): always on the client of the
 * transaction that changes the booking, so the email exists exactly when the
 * change does (code rule 1: only this file writes outbox rows). One row per
 * recipient. Nothing here sends; drain.ts does, after COMMIT.
 *
 * Nothing a guest can send may make these inserts fail, or the booking would
 * fail with them (spec §12): the guest address is filtered before the CHECK,
 * locales come from rows that already passed their FK, and no recipient means
 * one fallback row, never an error. SQL in these template literals spells
 * whitespace [:space:]: a backslash class would lose its backslash.
 */

type Queue = { reservationId: string; eventId: string; env: OutboxEnv };

/**
 * One guest row, to the address and in the language stored on the booking;
 * none when the booking has no email, or one email_outbox would refuse (the
 * guest form lets "a@b@c.vn" through; R13). `ackSetting`: only while "Cài đặt
 * đặt bàn" keeps guest_ack_email on, read in the same transaction.
 */
export async function queueGuestEmail(
  client: PoolClient,
  { reservationId, eventId, env, event, ackSetting = false }: Queue & { event: GuestEmailEventName; ackSetting?: boolean },
): Promise<string[]> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO email_outbox (env, event, audience, reservation_id, reservation_event_id, to_email, locale)
     SELECT $1, $2, 'guest', r.id, $4, r.email, r.locale
       FROM reservations r
      WHERE r.id = $3 AND r.email ~ '^[^@[:space:]]+@[^@[:space:]]+$' AND length(r.email) <= 254
        AND (NOT $5 OR (SELECT guest_ack_email FROM booking_settings))
     RETURNING id::text`,
    [env, event, reservationId, eventId, ackSetting],
  );
  return rows.map((r) => r.id);
}

/**
 * staff.new to the union of the active recipients of the booking's
 * restaurant, its destination and 'all', one row per address (case-folded;
 * the most specific scope's spelling and language win). When nobody matches,
 * one row to site_settings.email in Vietnamese, marked fallback (the overview
 * names the restaurants that have no recipient).
 */
export async function queueStaffNew(client: PoolClient, { reservationId, eventId, env }: Queue): Promise<string[]> {
  const { rows } = await client.query<{ id: string }>(
    `WITH booking AS (
       SELECT r.id, r.restaurant_id, rest.destination
         FROM reservations r JOIN restaurants rest ON rest.id = r.restaurant_id
        WHERE r.id = $2
     ),
     matched AS (
       SELECT DISTINCT ON (lower(n.email)) n.email, n.locale
         FROM notification_recipients n, booking b
        WHERE n.active AND 'staff.new' = ANY (n.events) AND ${reachesSql('n', 'b.restaurant_id', 'b.destination')}
        ORDER BY lower(n.email), CASE n.scope WHEN 'restaurant' THEN 0 WHEN 'destination' THEN 1 ELSE 2 END, n.id
     ),
     chosen AS (
       SELECT email, locale, false AS fallback FROM matched
       UNION ALL
       SELECT s.email, 'vi', true FROM site_settings s WHERE NOT EXISTS (SELECT 1 FROM matched)
     )
     INSERT INTO email_outbox (env, event, audience, reservation_id, reservation_event_id, to_email, locale, fallback)
     SELECT $1, 'staff.new', 'staff', b.id, $3, c.email, c.locale, c.fallback
       FROM chosen c, booking b
     RETURNING id::text`,
    [env, reservationId, eventId],
  );
  return rows.map((r) => r.id);
}

/**
 * A guest's booking from the web form (spec §10.2 step 6, §10.3 first row):
 * staff.new, then guest.confirmed when auto-confirmed, or guest.ack when the
 * request waits and guest_ack_email is on.
 */
export async function queueWebBookingEmails(client: PoolClient, queue: Queue & { status: 'requested' | 'confirmed' }): Promise<string[]> {
  const staff = await queueStaffNew(client, queue);
  const guest =
    queue.status === 'confirmed'
      ? await queueGuestEmail(client, { ...queue, event: 'guest.confirmed' })
      : await queueGuestEmail(client, { ...queue, event: 'guest.ack', ackSetting: true });
  return [...staff, ...guest];
}

/**
 * The phase-4 hooks (lib/server/booking/reservations.ts) made to queue email
 * (spec §10.3, R8). `queued` collects the new row ids for the drain: read it
 * only after the call resolved ok; a rolled-back transaction leaves ids that
 * no longer exist, which the drain simply does not find. staff.new is for web
 * bookings only (R4): staff do not tell themselves.
 */
export function outboxEffects(env: OutboxEnv = outboxEnv()): Required<ReservationEffects> & { queued: string[] } {
  const queued: string[] = [];
  return {
    queued,
    async afterTransition(client, { reservationId, transition, eventId, notifyGuest }) {
      const guest = transition.guestEmail;
      if (!guest || (guest.when === 'if_notify' && !notifyGuest)) return;
      queued.push(...(await queueGuestEmail(client, { reservationId, eventId, env, event: guest.event })));
    },
    async afterCreate(client, { reservationId, status, eventId, notifyGuest }) {
      // "Gửi email xác nhận" is for a phone booking (confirmed); a walk-in is already at the table (R8).
      if (!notifyGuest || status !== 'confirmed') return;
      queued.push(...(await queueGuestEmail(client, { reservationId, eventId, env, event: 'guest.confirmed' })));
    },
  };
}
