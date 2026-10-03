import 'server-only';
import type { Pool, PoolClient } from 'pg';
import type { GroupPhone, ReservationStatus } from '@/lib/booking/rules';
import { groupPhoneSql } from '@/lib/server/booking/rules';
import type { IsoDate } from '@/lib/venue-time';

/*
 * The reservation as a booking email shows it, read when the email is sent
 * (spec §10.4: the sender re-reads the booking): the drain decides from it
 * whether the email still holds (R7), and the renderer prints it, so an edit
 * made after the email was queued shows, and email_outbox holds no guest text
 * but the address. Internal notes (reservation_notes) are never loaded here
 * (code rule 10).
 */

export type BookingEmailData = {
  reservationId: string;
  reference: string;
  restaurantName: string;
  date: IsoDate;
  time: string;
  guests: number;
  status: ReservationStatus;
  /** The decline or cancellation reason staff typed; a guest reads it verbatim. */
  statusReason: string | null;
  guestName: string;
  phone: string;
  email: string | null;
  /** The guest's own request from the form. */
  note: string | null;
  /** The restaurant's number, else its destination's, which guests call (lib/server/booking/rules.ts groupPhoneSql). */
  groupPhone: GroupPhone | null;
  /** Phase 10's anonymiser ran: nothing is sent about it any more. */
  anonymized: boolean;
};

type DataRow = {
  id: string;
  reference: string;
  restaurant_name: string;
  date: string;
  time: string;
  guests: number;
  status: ReservationStatus;
  status_reason: string | null;
  guest_name: string;
  phone: string;
  email: string | null;
  note: string | null;
  group_phone: GroupPhone | null;
  anonymized: boolean;
};

/** The booking, or null when it no longer exists. Dates leave SQL through to_char (phase-4 code rule 3). */
export async function loadBookingEmailData(db: Pool | PoolClient, reservationId: string): Promise<BookingEmailData | null> {
  const { rows } = await db.query<DataRow>(
    `SELECT r.id::text, r.reference, t.name AS restaurant_name, to_char(r.reserved_on, 'YYYY-MM-DD') AS date,
            r.reserved_at AS time, r.guests, r.status, r.status_reason, r.guest_name, r.phone, r.email, r.note,
            ${groupPhoneSql('t')} AS group_phone, r.anonymized_at IS NOT NULL AS anonymized
       FROM reservations r JOIN restaurants t ON t.id = r.restaurant_id
      WHERE r.id = $1`,
    [reservationId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    reservationId: r.id,
    reference: r.reference,
    restaurantName: r.restaurant_name,
    date: r.date,
    time: r.time,
    guests: r.guests,
    status: r.status,
    statusReason: r.status_reason,
    guestName: r.guest_name,
    phone: r.phone,
    email: r.email,
    note: r.note,
    groupPhone: r.group_phone,
    anonymized: r.anonymized,
  };
}
