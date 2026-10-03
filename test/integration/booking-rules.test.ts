import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool } from '@/db/client';
import { lockBookingDay } from '@/lib/server/booking/lock';
import { loadBookedCovers, loadBookingRules, loadRestaurantRules } from '@/lib/server/booking/rules';

/* The live rule loaders (spec §10.1): booking_settings merged with the restaurant's overrides, its active periods, the closures that reach it. */

const sql = (text: string, values: unknown[] = []) => getPool().query(text, values);

const book = (restaurant: string, date: string, time: string, guests: number, status: string, phone: string) =>
  sql(
    `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source, status)
     VALUES ('FC-' || substr(md5(random()::text), 1, 8), $1, $2, $3, 'Dinner', $4, 'An', $5, $5, 'web', $6)`,
    [restaurant, date, time, guests, phone, status],
  );

const closure = async (scope: string, target: { destination?: string; restaurant?: string }, from: string, to: string, meals: string[] | null = null) => {
  const { rows } = await sql(
    `INSERT INTO closures (scope, destination_id, restaurant_id, starts_on, ends_on, meals) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [scope, target.destination ?? null, target.restaurant ?? null, from, to, meals],
  );
  return rows[0].id as string;
};

describe.skipIf(!process.env.TEST_DATABASE_URL)('booking rule loaders (database)', () => {
  beforeEach(async () => {
    await sql('DELETE FROM reservations');
    await sql('DELETE FROM closures');
    await sql(`UPDATE locales SET is_enabled = false, serve_machine = false WHERE code = 'vi'`);
    await sql('UPDATE booking_settings SET window_days = 14, lead_minutes = 30, same_day_cutoff = NULL, max_party = 12, auto_confirm = false');
    await sql('UPDATE restaurants SET booking_enabled = true, window_days = NULL, lead_minutes = NULL, max_party = NULL, auto_confirm = NULL');
    await sql(`UPDATE service_periods SET active = true WHERE restaurant_id = 'taya-house'`);
  });
  afterAll(() => getPool().end());

  it('inherits booking_settings, and a restaurant override wins', async () => {
    await sql(`UPDATE booking_settings SET same_day_cutoff = '17:00', auto_confirm = true`);
    await sql(`UPDATE restaurants SET max_party = 8, lead_minutes = 60, auto_confirm = false, booking_enabled = false WHERE id = 'the-fan'`);
    const loaded = await loadBookingRules(getPool(), ['taya-house', 'the-fan', 'nowhere'], 'en', '2026-10-01');
    expect([...loaded.keys()]).toEqual(['taya-house', 'the-fan']);
    const pick = (id: string) => {
      const r = loaded.get(id)!.rules;
      return [r.bookingEnabled, r.windowDays, r.leadMinutes, r.sameDayCutoff, r.maxParty, r.autoConfirm];
    };
    expect(pick('taya-house')).toEqual([true, 14, 30, '17:00', 12, true]);
    // The cut-off is global only (spec §5.2 lists no per-restaurant override).
    expect(pick('the-fan')).toEqual([false, 14, 60, '17:00', 8, false]);
  });

  it('loads the active periods in sort order, times as HH:MM', async () => {
    const taya = (await loadRestaurantRules(getPool(), 'taya-house', 'en', '2026-10-01'))!.rules;
    expect(taya).toMatchObject({ restaurantId: 'taya-house', restaurantName: 'Tàya House', destinationId: 'resort' });
    expect(taya.periods.map((p) => [p.meal, p.weekdays, p.firstSeating, p.lastSeating, p.intervalMin, p.coversPerSlot, p.sortOrder])).toEqual([
      ['Lunch', [1, 2, 3, 4, 5, 6, 7], '11:30', '13:30', 30, 16, 20],
      ['Dinner', [1, 2, 3, 4, 5, 6, 7], '18:00', '21:00', 30, 16, 40],
    ]);
    await sql(`UPDATE service_periods SET active = false WHERE restaurant_id = 'taya-house' AND meal = 'Lunch'`);
    const after = (await loadRestaurantRules(getPool(), 'taya-house', 'en', '2026-10-01'))!.rules;
    expect(after.periods.map((p) => p.meal)).toEqual(['Dinner']);
    expect(await loadRestaurantRules(getPool(), 'nowhere', 'en', '2026-10-01')).toBeNull();
  });

  it('picks the closures that reach the restaurant and have not ended before `from`', async () => {
    await closure('all', {}, '2026-12-24', '2026-12-25');
    await closure('destination', { destination: 'resort' }, '2026-10-05', '2026-10-05', ['Dinner']);
    await closure('destination', { destination: 'dining-house' }, '2026-10-06', '2026-10-06');
    await closure('restaurant', { restaurant: 'taya-house' }, '2026-09-28', '2026-09-30');
    await closure('restaurant', { restaurant: 'taya-house' }, '2026-09-28', '2026-10-01');
    await closure('restaurant', { restaurant: 'pho-cuon' }, '2026-10-07', '2026-10-07');
    const taya = (await loadRestaurantRules(getPool(), 'taya-house', 'en', '2026-10-01'))!.rules;
    expect(taya.closures.map((c) => [c.scope, c.startsOn, c.endsOn, c.meals])).toEqual([
      ['restaurant', '2026-09-28', '2026-10-01', null],
      ['destination', '2026-10-05', '2026-10-05', ['Dinner']],
      ['all', '2026-12-24', '2026-12-25', null],
    ]);
    // A staff action on yesterday still sees yesterday's closures.
    const earlier = (await loadRestaurantRules(getPool(), 'taya-house', 'en', '2026-09-30'))!.rules;
    expect(earlier.closures).toHaveLength(4);
  });

  it('serves the reason in the guest’s language only when that language is on, else the default', async () => {
    const id = await closure('restaurant', { restaurant: 'taya-house' }, '2026-10-04', '2026-10-04');
    await sql(`INSERT INTO closure_i18n (closure_id, locale, public_reason) VALUES ($1, 'en', 'Private event'), ($1, 'vi', 'Sự kiện riêng')`, [id]);
    const reason = async (locale: string) => (await loadRestaurantRules(getPool(), 'taya-house', locale, '2026-10-01'))!.rules.closures[0].publicReason;
    // vi is off for the site: English, even though the vi row is reviewed.
    expect(await reason('vi')).toBe('Private event');
    await sql(`UPDATE locales SET is_enabled = true WHERE code = 'vi'`);
    expect(await reason('vi')).toBe('Sự kiện riêng');
    // A machine translation is served only with serve_machine on.
    await sql(`UPDATE closure_i18n SET status = 'machine' WHERE locale = 'vi'`);
    expect(await reason('vi')).toBe('Private event');
    await sql(`UPDATE locales SET serve_machine = true WHERE code = 'vi'`);
    expect(await reason('vi')).toBe('Sự kiện riêng');
    expect(await reason('xx')).toBe('Private event');
    // show_reason off: no reason in any language.
    await sql('UPDATE closures SET show_reason = false');
    expect(await reason('vi')).toBeNull();
  });

  it('gives each restaurant a group phone: its destination’s, else the first destination that has one', async () => {
    const loaded = await loadBookingRules(getPool(), ['taya-house', 'the-fan', 'yum-food-village'], 'en', '2026-10-01');
    expect(Object.fromEntries([...loaded].map(([id, l]) => [id, l.groupPhone]))).toEqual({
      'taya-house': { display: '+84 236 651 9999', tel: '+842366519999' },
      'the-fan': { display: '0859 555 759', tel: '+84859555759' },
      'yum-food-village': { display: '+84 236 651 9999', tel: '+842366519999' },
    });
  });

  it('prefers the restaurant’s own number, then its destination’s; none only when no number exists at all (phase-4 ledger T3)', async () => {
    await sql(`UPDATE restaurants SET phone_e164 = '+842363847333', phone_display = '0236 3847 333' WHERE id = 'the-fan'`);
    try {
      const own = await loadBookingRules(getPool(), ['the-fan', 'pho-cuon'], 'en', '2026-10-01');
      expect(own.get('the-fan')?.groupPhone).toEqual({ display: '0236 3847 333', tel: '+842363847333' });
      expect(own.get('pho-cuon')?.groupPhone).toEqual({ display: '0859 555 759', tel: '+84859555759' });
      await sql(`UPDATE restaurants SET phone_e164 = NULL, phone_display = NULL WHERE id = 'the-fan'`);
      await sql(`UPDATE destinations SET phone_e164 = NULL, phone_display = NULL`);
      // The drawer and the emails then say nothing about a number (no "call us on" with a blank).
      expect((await loadRestaurantRules(getPool(), 'taya-house', 'en', '2026-10-01'))!.groupPhone).toBeNull();
    } finally {
      await sql(`UPDATE restaurants SET phone_e164 = NULL, phone_display = NULL WHERE id = 'the-fan'`);
      await sql(`UPDATE destinations SET phone_e164 = '+842366519999', phone_display = '+84 236 651 9999' WHERE id = 'resort'`);
      await sql(`UPDATE destinations SET phone_e164 = '+84859555759', phone_display = '0859 555 759' WHERE id = 'dining-house'`);
    }
  });

  it('orders restaurants with the same sort_order by id (phase-4 ledger T3)', async () => {
    const { rows } = await sql(`SELECT id, sort_order FROM restaurants WHERE id IN ('taya-house', 'danaksara', 'cafe-indochine')`);
    // One by one, in reverse id order: each update moves its row to the end of the table, so an order
    // on sort_order alone hands them back as taya-house, danaksara, cafe-indochine.
    for (const id of ['taya-house', 'danaksara', 'cafe-indochine']) await sql(`UPDATE restaurants SET sort_order = 1 WHERE id = $1`, [id]);
    try {
      const loaded = await loadBookingRules(getPool(), ['taya-house', 'danaksara', 'cafe-indochine'], 'en', '2026-10-01');
      expect([...loaded.keys()]).toEqual(['cafe-indochine', 'danaksara', 'taya-house']);
    } finally {
      for (const r of rows) await sql(`UPDATE restaurants SET sort_order = $2 WHERE id = $1`, [r.id, r.sort_order]);
    }
  });

  it('an unpublished or archived restaurant does not book online, whatever its switch says (R10)', async () => {
    try {
      await sql(`UPDATE restaurants SET is_published = false WHERE id = 'the-fan'`);
      await sql(`UPDATE restaurants SET archived_at = now() WHERE id = 'pho-cuon'`);
      const loaded = await loadBookingRules(getPool(), ['the-fan', 'pho-cuon', 'taya-house'], 'en', '2026-10-01');
      expect([...loaded].map(([id, l]) => [id, l.rules.bookingEnabled])).toEqual([
        ['taya-house', true],
        ['the-fan', false],
        ['pho-cuon', false],
      ]);
    } finally {
      await sql(`UPDATE restaurants SET is_published = true, archived_at = NULL WHERE id IN ('the-fan', 'pho-cuon')`);
    }
  });

  it('counts covers per date and time over the holding statuses only', async () => {
    await book('taya-house', '2026-10-05', '19:00', 2, 'requested', '+84905000001');
    await book('taya-house', '2026-10-05', '19:00', 3, 'confirmed', '+84905000002');
    await book('taya-house', '2026-10-05', '19:00', 4, 'seated', '+84905000003');
    await book('taya-house', '2026-10-05', '19:00', 5, 'no_show', '+84905000004');
    await book('taya-house', '2026-10-05', '19:00', 6, 'cancelled', '+84905000005');
    await book('taya-house', '2026-10-05', '19:00', 7, 'declined', '+84905000006');
    await book('taya-house', '2026-10-06', '12:00', 2, 'requested', '+84905000007');
    await book('taya-house', '2026-10-08', '12:00', 2, 'requested', '+84905000008');
    await book('the-fan', '2026-10-05', '19:00', 2, 'requested', '+84905000009');
    expect(await loadBookedCovers(getPool(), 'taya-house', '2026-10-05', '2026-10-07')).toEqual({
      '2026-10-05': { '19:00': 9 },
      '2026-10-06': { '12:00': 2 },
    });
    // An edit re-checks its slot without counting itself.
    const { rows } = await sql(`SELECT id::text FROM reservations WHERE phone_e164 = '+84905000003'`);
    expect(await loadBookedCovers(getPool(), 'taya-house', '2026-10-05', '2026-10-05', rows[0].id)).toEqual({ '2026-10-05': { '19:00': 5 } });
  });

  it('serialises one restaurant-day, and gives up after lock_timeout with 55P03', async () => {
    const other = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 2 });
    const holder = await getPool().connect();
    const waiter = await other.connect();
    try {
      await holder.query('BEGIN');
      await lockBookingDay(holder, 'taya-house', '2026-10-05');
      await waiter.query('BEGIN');
      // Another date of the same restaurant is a different lock.
      await lockBookingDay(waiter, 'taya-house', '2026-10-06', { timeout: '1s' });
      const started = Date.now();
      await expect(lockBookingDay(waiter, 'taya-house', '2026-10-05', { timeout: '1s' })).rejects.toMatchObject({ code: '55P03' });
      expect(Date.now() - started).toBeGreaterThanOrEqual(900);
      await waiter.query('ROLLBACK');
      await holder.query('COMMIT');
      // Released at COMMIT.
      await waiter.query('BEGIN');
      await lockBookingDay(waiter, 'taya-house', '2026-10-05', { timeout: '1s' });
      await waiter.query('COMMIT');
    } finally {
      holder.release();
      waiter.release();
      await other.end();
    }
  });

  it('sets lock_timeout for its own transaction only: the pooled connection is back to its default after COMMIT', async () => {
    // A session-wide 5s would follow the connection back into the pool and time out unrelated statements.
    const client = await getPool().connect();
    const timeout = async () => (await client.query<{ lock_timeout: string }>('SHOW lock_timeout')).rows[0].lock_timeout;
    try {
      const before = await timeout();
      expect(before).not.toBe('5s');
      await client.query('BEGIN');
      await lockBookingDay(client, 'taya-house', '2026-10-05');
      expect(await timeout()).toBe('5s');
      await client.query('COMMIT');
      expect(await timeout()).toBe(before);
    } finally {
      // Destroyed, not returned: a failed run must not hand the pool a connection with a changed setting.
      client.release(true);
    }
  });
});
