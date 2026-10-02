import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { INBOX_PAGE_SIZE, daySheet, getReservation, listEvents, listInbox, listLocales, listNotes, overviewCounts } from '@/lib/server/booking/queries';
import { TEST_DATABASE_URL } from '../helpers/db';

/*
 * Spec §7.2 /admin/reservations: the tabs, search by reference, phone, name or
 * email (search_text, folded like fold_search), keyset paging; the detail
 * reads; the overview counts. Dates leave SQL as YYYY-MM-DD (npm test runs on UTC).
 */

let pool: Pool;
const TODAY = '2026-10-02';

type Seed = {
  reference?: string;
  name?: string;
  email?: string | null;
  phone?: string;
  date?: string;
  time?: string;
  status?: string;
  guests?: number;
  restaurant?: string;
  createdAt?: string;
};

async function seed(over: Seed = {}): Promise<string> {
  const phone = over.phone ?? `+849052${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, phone_e164, email, status, meal, source, created_at)
     VALUES (coalesce($1, 'FC-' || upper(substr(md5(random()::text), 1, 8))), $2, $3::date, $4, $5, $6, $7, $7, $8, $9, 'Dinner', 'web',
             coalesce($10::timestamptz, now()))
     RETURNING id::text`,
    [
      over.reference ?? null,
      over.restaurant ?? 'taya-house',
      over.date ?? '2026-10-05',
      over.time ?? '19:00',
      over.guests ?? 2,
      over.name ?? 'Khách',
      phone,
      over.email ?? null,
      over.status ?? 'requested',
      over.createdAt ?? null,
    ],
  );
  return rows[0].id;
}

const ids = (r: { rows: { id: string }[] }) => r.rows.map((x) => x.id);

describe.skipIf(!TEST_DATABASE_URL)('reservation inbox (database)', () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE reservations, reservation_events, reservation_notes, closures CASCADE');
    await pool.query(`UPDATE service_periods SET active = true WHERE restaurant_id = 'taya-house'`);
  });

  it('tabs: Cần xử lý (requested, soonest first) · Hôm nay · Sắp tới · Tất cả (newest first)', async () => {
    const later = await seed({ date: '2026-10-06', status: 'requested', createdAt: '2026-10-01T01:00Z' });
    const sooner = await seed({ date: '2026-10-03', status: 'requested', createdAt: '2026-10-01T02:00Z' });
    const today = await seed({ date: TODAY, time: '12:00', status: 'confirmed', createdAt: '2026-10-01T03:00Z' });
    const todayCancelled = await seed({ date: TODAY, time: '19:00', status: 'cancelled', createdAt: '2026-10-01T04:00Z' });
    const upcomingConfirmed = await seed({ date: '2026-10-04', status: 'confirmed', createdAt: '2026-10-01T05:00Z' });
    expect(ids(await listInbox(pool, { tab: 'pending', today: TODAY }))).toEqual([sooner, later]);
    expect(ids(await listInbox(pool, { tab: 'today', today: TODAY }))).toEqual([today, todayCancelled]);
    expect(ids(await listInbox(pool, { tab: 'upcoming', today: TODAY }))).toEqual([sooner, upcomingConfirmed, later]);
    expect(ids(await listInbox(pool, { tab: 'all', today: TODAY }))).toEqual([upcomingConfirmed, todayCancelled, today, sooner, later]);
    const [row] = (await listInbox(pool, { tab: 'today', today: TODAY })).rows;
    expect(row).toMatchObject({ date: TODAY, time: '12:00', restaurantName: 'Tàya House', status: 'confirmed', version: 1, source: 'web' });
  });

  it('finds by new and legacy reference, typed loosely', async () => {
    const fresh = await seed({ reference: 'FC-7K3QH9XA' });
    const legacy = await seed({ reference: 'FC-12345' });
    expect(ids(await listInbox(pool, { tab: 'pending', q: 'fc7k3qh9xa', today: TODAY }))).toEqual([fresh]);
    expect(ids(await listInbox(pool, { tab: 'pending', q: 'FC 12345', today: TODAY }))).toEqual([legacy]);
  });

  it('finds by phone in any format, by a few digits, by name without accents, by email; never by a wildcard', async () => {
    const anh = await seed({ name: 'Nguyễn Minh Ánh', phone: '+84905123456', email: 'Anh.Nguyen@Example.com' });
    const binh = await seed({ name: 'TRẦN VĂN BÌNH', phone: '+84912000999' });
    const search = async (q: string) => ids(await listInbox(pool, { tab: 'today', q, today: TODAY }));
    expect(await search('0905 123 456')).toEqual([anh]);
    expect(await search('+84 905-123-456')).toEqual([anh]);
    expect(await search('3456')).toEqual([anh]);
    expect(await search('nguyen minh anh')).toEqual([anh]);
    expect(await search('Bình')).toEqual([binh]);
    expect(await search('anh.nguyen@example')).toEqual([anh]);
    // a LIKE wildcard is a character, not "anything": unescaped, these would find Ánh and Bình.
    expect(await search('ngu%anh')).toEqual([]);
    expect(await search('b_nh')).toEqual([]);
    // A search ignores the tab: neither booking is today.
    expect((await listInbox(pool, { tab: 'today', q: 'tran', today: TODAY })).searched).toBe(true);
  });

  it('pages with keyset cursors, without repeats or gaps, in both orders', async () => {
    const total = INBOX_PAGE_SIZE * 2 + 5;
    // Many rows on one sitting (ties broken by id), and created_at values that share a millisecond.
    await pool.query(
      `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, phone_e164, status, meal, source, created_at)
       SELECT 'FC-' || lpad(g::text, 5, '0'), 'taya-house', '2026-10-05', CASE WHEN g % 2 = 0 THEN '19:00' ELSE '18:30' END, 1, 'Khách ' || g,
              '+8490530' || lpad(g::text, 4, '0'), '+8490530' || lpad(g::text, 4, '0'), 'requested', 'Dinner', 'web',
              timestamptz '2026-10-01 10:00:00.000500+00' - g * interval '1 microsecond'
         FROM generate_series(1, $1) AS g`,
      [total],
    );
    for (const tab of ['pending', 'all'] as const) {
      const seen: string[] = [];
      let after: string | null = null;
      for (let page = 0; page < 5; page++) {
        const result: Awaited<ReturnType<typeof listInbox>> = await listInbox(pool, { tab, after, today: TODAY });
        seen.push(...result.rows.map((r) => r.reference));
        after = result.next;
        if (!after) break;
      }
      expect(seen).toHaveLength(total);
      expect(new Set(seen).size).toBe(total);
    }
    const first = await listInbox(pool, { tab: 'pending', today: TODAY });
    expect(first.rows.slice(0, 2).map((r) => r.time)).toEqual(['18:30', '18:30']);
  });

  it('reads one booking with its timeline (newest first) and its internal notes', async () => {
    const id = await seed({ name: 'Lan', email: 'lan@example.com' });
    await pool.query(
      `INSERT INTO reservation_events (reservation_id, at, actor_kind, type, to_status) VALUES ($1, now() - interval '1 hour', 'guest', 'created', 'requested')`,
      [id],
    );
    await pool.query(
      `INSERT INTO reservation_events (reservation_id, actor_kind, actor_id, actor_label, type, from_status, to_status)
       VALUES ($1, 'staff', 'u1', 'Mai (mai@furama.test)', 'status_changed', 'requested', 'confirmed')`,
      [id],
    );
    await pool.query(`INSERT INTO reservation_notes (reservation_id, author_id, author_label, body) VALUES ($1, 'u1', 'Mai', 'Bàn gần cửa sổ')`, [id]);
    expect(await getReservation(pool, id)).toMatchObject({ id, name: 'Lan', email: 'lan@example.com', date: '2026-10-05', meal: 'Dinner', locale: 'en' });
    expect(await getReservation(pool, '999999')).toBeNull();
    expect(await getReservation(pool, 'abc')).toBeNull();
    expect((await listEvents(pool, id)).map((e) => [e.type, e.actorLabel])).toEqual([
      ['status_changed', 'Mai (mai@furama.test)'],
      ['created', null],
    ]);
    expect((await listNotes(pool, [id])).get(id)?.map((n) => n.body)).toEqual(['Bàn gần cửa sổ']);
    expect(await listNotes(pool, [])).toEqual(new Map());
  });

  it('overview: pending requests, and today’s bookings and covers that hold seats', async () => {
    await seed({ status: 'requested' });
    await seed({ date: TODAY, guests: 4, status: 'confirmed' });
    await seed({ date: TODAY, guests: 2, status: 'requested' });
    await seed({ date: TODAY, guests: 3, status: 'seated' });
    await seed({ date: TODAY, guests: 9, status: 'cancelled' });
    await seed({ date: TODAY, guests: 5, status: 'no_show' });
    expect(await overviewCounts(pool, TODAY)).toEqual({ pending: 2, today: 3, todayCovers: 9 });
  });

  it('the day sheet: each service’s slots with the covers held, the bookings that still count, and those outside the hours', async () => {
    await seed({ time: '19:00', guests: 4, status: 'confirmed' });
    await seed({ time: '19:00', guests: 3, status: 'seated' });
    await seed({ time: '19:00', guests: 5, status: 'no_show' });
    await seed({ time: '19:00', guests: 6, status: 'cancelled' });
    // Booked when dinner ran later: 21:30 is no longer a slot.
    const late = await seed({ time: '21:30', guests: 2, status: 'confirmed' });
    await pool.query(`INSERT INTO closures (scope, restaurant_id, starts_on, ends_on, meals) VALUES ('restaurant', 'taya-house', '2026-10-05', '2026-10-05', '{Lunch}')`);
    const [taya] = await daySheet(pool, '2026-10-05', 'taya-house');
    expect(taya.name).toBe('Tàya House');
    expect(taya.reservations.map((r) => [r.time, r.status])).toEqual([
      ['19:00', 'confirmed'],
      ['19:00', 'seated'],
      ['19:00', 'no_show'],
      ['21:30', 'confirmed'],
    ]);
    expect(taya.periods.map((p) => [p.meal, p.closed])).toEqual([
      ['Lunch', true],
      ['Dinner', false],
    ]);
    expect(taya.periods[1].slots.find((s) => s.time === '19:00')).toEqual({ time: '19:00', capacity: 16, booked: 7 });
    expect(taya.outside.map((r) => r.id)).toEqual([late]);
    expect((await daySheet(pool, '2026-10-05')).map((r) => r.id)).toContain('hai-van-lounge');
  });

  it('lists every language a guest may speak, enabled or not, the default marked', async () => {
    expect(await listLocales(pool)).toEqual([
      { code: 'en', name: 'English', isDefault: true },
      { code: 'vi', name: 'Tiếng Việt', isDefault: false },
    ]);
  });
});
