import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { listRestaurantBookings, restaurantsInScope } from '@/lib/server/booking/config';
import { createWebReservation } from '@/lib/server/booking/create';
import { parseReservationInput } from '@/lib/server/booking/input';
import { loadRestaurantRules } from '@/lib/server/booking/rules';
import { drainOutbox } from '@/lib/server/email/drain';
import { restaurantsWithoutRecipient } from '@/lib/server/email/recipients';
import { TEST_DATABASE_URL } from '../helpers/db';

/*
 * R10 (phase 6): a restaurant's destination is restaurants.destination_id
 * (migration 008). The phase-1 column restaurants.destination stays until
 * phase 10 drops it, but nothing reads it any more. Here Tàya House moves to
 * Furama Dining House in destination_id only (its phase-1 column still says
 * resort), and every reader that groups restaurants by destination follows:
 * the booking rules (closures, the group phone), the closure scope, the admin
 * restaurant list, the staff.new queue, the drain's re-check and the
 * overview's "no recipient" list.
 */

let pool: Pool;
// Friday 2 Oct 2026, 10:00 in Da Nang; the booking below is for Monday 5 Oct (the drain skips a passed sitting).
const NOW = new Date('2026-10-02T10:00:00+07:00');

const sql = (text: string, values: unknown[] = []) => pool.query(text, values);

describe.skipIf(!TEST_DATABASE_URL)('a restaurant’s destination is restaurants.destination_id (R10)', () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
  });
  afterAll(async () => {
    await sql('TRUNCATE email_outbox, notification_recipients');
    await pool.end();
  });
  beforeEach(async () => {
    await sql('TRUNCATE reservations, reservation_events, closures, email_outbox, notification_recipients CASCADE');
    await sql('UPDATE restaurants SET booking_enabled = true, window_days = NULL, lead_minutes = NULL, max_party = NULL, auto_confirm = NULL');
    await sql('UPDATE booking_settings SET window_days = 14, lead_minutes = 30, same_day_cutoff = NULL, max_party = 12, auto_confirm = false');
    await sql(`UPDATE restaurants SET destination_id = 'dining-house' WHERE id = 'taya-house'`);
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await sql(`UPDATE restaurants SET destination_id = 'resort' WHERE id = 'taya-house'`);
  });

  it('the booking rules: the closures of that destination, and its phone for larger groups', async () => {
    await sql(`INSERT INTO closures (scope, destination_id, starts_on, ends_on) VALUES ('destination', 'dining-house', '2026-10-06', '2026-10-06')`);
    await sql(`INSERT INTO closures (scope, destination_id, starts_on, ends_on) VALUES ('destination', 'resort', '2026-10-07', '2026-10-07')`);
    const loaded = (await loadRestaurantRules(pool, 'taya-house', 'en', '2026-10-01'))!;
    expect(loaded.rules.destinationId).toBe('dining-house');
    expect(loaded.rules.closures.map((c) => [c.destinationId, c.startsOn])).toEqual([['dining-house', '2026-10-06']]);
    expect(loaded.groupPhone).toEqual({ display: '0859 555 759', tel: '+84859555759' });
  });

  it('the closure scope and the admin’s restaurant list', async () => {
    expect(await restaurantsInScope(pool, { scope: 'destination', destinationId: 'dining-house', restaurantId: null })).toContain('taya-house');
    expect(await restaurantsInScope(pool, { scope: 'destination', destinationId: 'resort', restaurantId: null })).not.toContain('taya-house');
    expect((await listRestaurantBookings(pool)).find((r) => r.id === 'taya-house')?.destinationId).toBe('dining-house');
  });

  it('staff.new: a recipient of that destination gets it, the drain still sends it, and the overview counts the restaurant reached', async () => {
    await sql(`INSERT INTO notification_recipients (scope, destination_id, email) VALUES ('destination', 'dining-house', 'dh@furama.test')`);
    const parsed = parseReservationInput({
      restaurant: 'taya-house', date: '2026-10-05', time: '19:00', guests: 2, name: 'Khách Web',
      phone: '0905 300 001', email: '', note: '', locale: 'en', consent: true,
    });
    if (!parsed.ok) throw new Error(parsed.code);
    expect((await createWebReservation(parsed.value, { now: NOW, pool })).ok).toBe(true);
    expect((await sql(`SELECT event, to_email, fallback FROM email_outbox`)).rows).toEqual([
      { event: 'staff.new', to_email: 'dh@furama.test', fallback: false },
    ]);
    expect(await drainOutbox({ pool, env: {}, now: NOW })).toMatchObject({ sent: 1, skipped: 0 });
    expect((await restaurantsWithoutRecipient(pool)).map((r) => r.id)).not.toContain('taya-house');
  });
});
