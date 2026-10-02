import { randomBytes, randomInt } from 'node:crypto';
import { serviceDay } from '../lib/reservations/lifecycle';
import { addDays, venueNow } from '../lib/venue-time';
import { db } from './staff-fixtures';

/*
 * Bookings for the admin specs, written straight into the local _test
 * database through db() (which refuses anything else). Each booking gets a
 * fresh reference and phone, so parallel specs never meet on the unique
 * indexes. Dates are Da Nang's, whatever the runner's timezone.
 */

/** Da Nang's calendar date, `days` from today. */
export const venueDay = (days = 0) => addDays(venueNow().date, days);

/** The service day now (it runs until 04:00 the next morning). */
export const serviceDayNow = () => serviceDay();

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const newReference = () => `FC-${Array.from({ length: 8 }, () => CROCKFORD[randomInt(32)]).join('')}`;

export type SeededReservation = { id: string; reference: string; phone: string };

export async function seedReservation(
  over: { restaurant?: string; date?: string; time?: string; guests?: number; status?: string; name?: string; meal?: string } = {},
): Promise<SeededReservation> {
  const reference = newReference();
  const phone = `+849${String(randomInt(10_000_000, 99_999_999))}`;
  const client = db();
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, phone_e164, status, meal, source)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7, $7, $8, $9, 'web') RETURNING id::text`,
      [
        reference,
        over.restaurant ?? 'taya-house',
        over.date ?? venueDay(3),
        over.time ?? '19:00',
        over.guests ?? 2,
        over.name ?? `Khách E2E ${randomBytes(2).toString('hex')}`,
        phone,
        over.status ?? 'requested',
        over.meal ?? 'Dinner',
      ],
    );
    return { id: rows[0].id, reference, phone };
  } finally {
    await client.end();
  }
}

export async function reservationRow(
  id: string,
): Promise<{ status: string; status_reason: string | null; version: number; reserved_at: string; guests: number; over_capacity: boolean }> {
  const client = db();
  await client.connect();
  try {
    return (await client.query('SELECT status, status_reason, version, reserved_at, guests, over_capacity FROM reservations WHERE id = $1', [id])).rows[0];
  } finally {
    await client.end();
  }
}
