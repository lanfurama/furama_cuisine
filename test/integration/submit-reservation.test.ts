import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * next/server's after() throws outside a request scope (E468), and these
 * tests call the action directly: collect the callbacks instead, and run them
 * where a test wants to see what the response would have triggered.
 */
const afterTasks = vi.hoisted(() => [] as (() => unknown)[]);
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => unknown) => void afterTasks.push(task),
}));

import { submitReservation } from '@/app/actions';
import { getPool } from '@/db/client';
import { createWebReservation } from '@/lib/server/booking/create';
import { parseReservationInput, type ReservationRequest } from '@/lib/server/booking/input';

const request = {
  restaurant: 'taya-house',
  date: '2026-10-02',
  time: '19:00',
  guests: 2,
  name: 'Nguyễn Minh Anh',
  phone: '0905 000 000',
  email: '',
  note: '',
};

const sql = (text: string, values: unknown[] = []) => getPool().query(text, values);
const phone = (i: number) => `0905 ${String(100000 + i).slice(0, 3)} ${String(100000 + i).slice(3)}`;
/** The group phone party_too_large carries: the resort's, Tàya's destination. */
const RESORT_PHONE = '+84 236 651 9999';

/** A parsed request, for calling createWebReservation directly. */
function parsed(over: Partial<typeof request> = {}): ReservationRequest {
  const result = parseReservationInput({ ...request, ...over });
  if (!result.ok) throw new Error(result.code);
  return result.value;
}

/** Opens `n` pool connections and runs a query on each, so parallel calls start together. */
async function warmPool(n: number) {
  const clients = await Promise.all(Array.from({ length: n }, () => getPool().connect()));
  await Promise.all(clients.map((c) => c.query('SELECT (SELECT count(*) FROM restaurants), (SELECT count(*) FROM reservations)')));
  clients.forEach((c) => c.release());
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('submitReservation v2 (database)', () => {
  beforeEach(async () => {
    afterTasks.length = 0;
    // Recipients survive DELETE FROM reservations; another file may leave one behind. Outbox rows go with their booking.
    await sql('DELETE FROM notification_recipients');
    await sql('DELETE FROM reservations');
    await sql('DELETE FROM closures');
    await sql('UPDATE restaurants SET booking_enabled = true, max_party = NULL, auto_confirm = NULL, lead_minutes = NULL, window_days = NULL');
    await sql('UPDATE booking_settings SET window_days = 14, lead_minutes = 30, max_party = 12, auto_confirm = false, same_day_cutoff = NULL');
    await sql(`UPDATE locales SET is_enabled = false, serve_machine = false WHERE code = 'vi'`);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T18:00:00Z')); // 01:00 on 2 Oct in Da Nang, server on UTC
  });
  afterEach(() => vi.useRealTimers());
  afterAll(() => getPool().end());

  it('stores the Da Nang date, the meal, the source, both phone forms and a created event', async () => {
    const result = await submitReservation({ ...request, email: 'An@Example.com', locale: 'en' });
    expect(result).toMatchObject({ ok: true, data: { date: '2026-10-02', status: 'requested' } });
    const reference = result.ok ? result.data.reference : '';
    expect(reference).toMatch(/^FC-[0-9A-HJKMNP-TV-Z]{8}$/);
    const { rows } = await sql(
      `SELECT to_char(reserved_on, 'YYYY-MM-DD') AS day, meal, source, locale, status, phone, phone_e164, search_text, version, is_test, confirmed_at
         FROM reservations`,
    );
    expect(rows).toEqual([
      {
        day: '2026-10-02', meal: 'Dinner', source: 'web', locale: 'en', status: 'requested', phone: '0905 000 000', phone_e164: '+84905000000',
        search_text: `nguyen minh anh an@example.com ${reference.toLowerCase()} 84905000000 0905000000`,
        version: 1, is_test: false, confirmed_at: null,
      },
    ]);
    const events = await sql(`SELECT actor_kind, actor_id, type, from_status, to_status FROM reservation_events`);
    expect(events.rows).toEqual([{ actor_kind: 'guest', actor_id: null, type: 'created', from_status: null, to_status: 'requested' }]);
  });

  it('queues staff.new and guest.ack in the booking transaction, and sends them only after the response (spec §10.2 steps 6–7)', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const result = await submitReservation({ ...request, email: 'an@example.com', locale: 'en' });
    expect(result.ok).toBe(true);
    const queued = await sql(`SELECT event, to_email, status FROM email_outbox ORDER BY id`);
    expect(queued.rows).toEqual([
      { event: 'staff.new', to_email: 'fb@furamavietnam.com', status: 'queued' },
      { event: 'guest.ack', to_email: 'an@example.com', status: 'queued' },
    ]);
    // after() got one task; running it is what Vercel's waitUntil does once the response is out.
    expect(afterTasks).toHaveLength(1);
    vi.useRealTimers();
    await afterTasks[0]();
    expect((await sql(`SELECT status, provider_id FROM email_outbox ORDER BY id`)).rows).toEqual([
      { status: 'sent', provider_id: 'log' },
      { status: 'sent', provider_id: 'log' },
    ]);
    expect(info.mock.calls.some(([line]) => String(line).startsWith('[outbox] sent id='))).toBe(true);
    // The drain's own log lines carry ids and events, never an address.
    expect(info.mock.calls.filter(([line]) => String(line).startsWith('[outbox]')).some(([line]) => String(line).includes('@'))).toBe(false);
    info.mockRestore();
  });

  it('a refused booking schedules no drain', async () => {
    expect(await submitReservation({ ...request, guests: 99 })).toMatchObject({ ok: false });
    expect(await submitReservation({ ...request, name: '' })).toMatchObject({ ok: false });
    expect(afterTasks).toHaveLength(0);
  });

  it('falls back to the default language for an unknown or disabled locale', async () => {
    await submitReservation({ ...request, locale: 'vi' }); // vi exists but is disabled
    await submitReservation({ ...request, time: '19:30', locale: 'zz' });
    expect((await sql('SELECT DISTINCT locale FROM reservations')).rows).toEqual([{ locale: 'en' }]);
  });

  it('confirms at once under auto_confirm, globally or per restaurant', async () => {
    await sql(`UPDATE restaurants SET auto_confirm = true WHERE id = 'taya-house'`);
    expect(await submitReservation(request)).toMatchObject({ ok: true, data: { status: 'confirmed' } });
    await sql(`UPDATE restaurants SET auto_confirm = false WHERE id = 'taya-house'`);
    await sql(`UPDATE booking_settings SET auto_confirm = true`);
    expect(await submitReservation({ ...request, time: '19:30' })).toMatchObject({ ok: true, data: { status: 'requested' } });
    const { rows } = await sql(`SELECT status, confirmed_at IS NOT NULL AS stamped FROM reservations ORDER BY id`);
    expect(rows).toEqual([{ status: 'confirmed', stamped: true }, { status: 'requested', stamped: false }]);
    expect((await sql(`SELECT to_status FROM reservation_events ORDER BY id`)).rows.map((r) => r.to_status)).toEqual(['confirmed', 'requested']);
  });

  it('answers with codes, never English copy', async () => {
    expect(await submitReservation({ ...request, guests: 40 })).toEqual({ ok: false, code: 'party_too_large', params: { max: '12', phone: RESORT_PHONE } });
    expect(await submitReservation({ ...request, date: '2026-10-16' })).toEqual({ ok: false, code: 'outside_window' });
    expect(await submitReservation({ ...request, date: '2026-10-01' })).toEqual({ ok: false, code: 'outside_window' });
    expect(await submitReservation({ ...request, time: '15:00' })).toEqual({
      ok: false, code: 'slot_unavailable', params: { restaurant: 'Tàya House' },
    });
    expect(await submitReservation({ ...request, restaurant: 'nowhere' })).toEqual({ ok: false, code: 'restaurant_unavailable' });
    await submitReservation(request);
    expect(await submitReservation({ ...request, phone: '+84 905 000 000' })).toEqual({ ok: false, code: 'duplicate' });
  });

  it('maps bad input to the field codes', async () => {
    const code = async (over: Record<string, unknown>) => {
      const r = await submitReservation({ ...request, ...over });
      return r.ok ? 'ok' : r.code;
    };
    expect(await code({ name: 'A' })).toBe('invalid_name');
    expect(await code({ phone: '1234' })).toBe('invalid_phone');
    expect(await code({ phone: '0000 0000 00' })).toBe('invalid_phone'); // eight digits, not a number
    expect(await code({ email: 'not-an-email' })).toBe('invalid_email');
    expect(await code({ date: '2026-02-30' })).toBe('outside_window');
    expect(await code({ time: '7pm' })).toBe('slot_unavailable');
    expect(await code({ guests: 0 })).toBe('unknown');
    expect(await code({ guests: 2.5 })).toBe('unknown');
    expect(await code({ note: 'x'.repeat(1001) })).toBe('unknown');
    expect(await submitReservation(null)).toEqual({ ok: false, code: 'unknown' });
    expect((await sql('SELECT count(*)::int AS n FROM reservations')).rows[0].n).toBe(0);
  });

  it('blocks a ninth guest when max_party is 8', async () => {
    await sql(`UPDATE restaurants SET max_party = 8 WHERE id = 'taya-house'`);
    expect(await submitReservation({ ...request, guests: 9 })).toEqual({ ok: false, code: 'party_too_large', params: { max: '8', phone: RESORT_PHONE } });
    // A Dining House restaurant names its own destination's number.
    await sql(`UPDATE restaurants SET max_party = 8 WHERE id = 'the-fan'`);
    expect(await submitReservation({ ...request, restaurant: 'the-fan', guests: 9 })).toEqual({
      ok: false, code: 'party_too_large', params: { max: '8', phone: '0859 555 759' },
    });
    expect(await submitReservation({ ...request, guests: 8 })).toMatchObject({ ok: true });
  });

  it('refuses a restaurant whose online booking is off', async () => {
    await sql(`UPDATE restaurants SET booking_enabled = false WHERE id = 'taya-house'`);
    expect(await submitReservation(request)).toEqual({ ok: false, code: 'restaurant_unavailable' });
  });

  it('refuses a closed service and keeps the others open', async () => {
    await sql(
      `INSERT INTO closures (scope, destination_id, starts_on, ends_on, meals) VALUES ('destination', 'resort', '2026-10-02', '2026-10-02', '{Dinner}')`,
    );
    expect(await submitReservation(request)).toEqual({ ok: false, code: 'closed' });
    expect(await submitReservation({ ...request, time: '12:00' })).toMatchObject({ ok: true });
    await sql(`INSERT INTO closures (scope, starts_on, ends_on) VALUES ('all', '2026-10-03', '2026-10-03')`);
    expect(await submitReservation({ ...request, date: '2026-10-03', time: '12:00' })).toEqual({ ok: false, code: 'closed' });
  });

  it('closes a sitting by Da Nang time: lead time and same-day cut-off', async () => {
    vi.setSystemTime(new Date('2026-10-02T12:00:00Z')); // 19:00 in Da Nang
    expect(await submitReservation({ ...request, time: '19:30' })).toEqual({ ok: false, code: 'past' });
    expect(await submitReservation({ ...request, time: '20:00' })).toMatchObject({ ok: true });
    await sql(`UPDATE booking_settings SET same_day_cutoff = '18:00'`);
    expect(await submitReservation({ ...request, time: '20:30' })).toEqual({ ok: false, code: 'past' });
    expect(await submitReservation({ ...request, date: '2026-10-03', time: '20:30' })).toMatchObject({ ok: true });
  });

  it('counts requested, confirmed and seated covers, not cancelled, declined or no-show ones', async () => {
    const insert = (status: string, guests: number, i: number) =>
      sql(
        `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source, status)
         VALUES ($1, 'taya-house', '2026-10-02', '19:00', 'Dinner', $2, 'G', 'x', $3, 'phone', $4)`,
        [`FC-TEST000${i}`, guests, `+8490500010${i}`, status],
      );
    await insert('requested', 4, 1);
    await insert('confirmed', 4, 2);
    await insert('seated', 4, 3);
    await insert('cancelled', 12, 4);
    await insert('declined', 12, 5);
    await insert('no_show', 12, 6);
    expect(await submitReservation({ ...request, guests: 5 })).toEqual({ ok: false, code: 'full' });
    expect(await submitReservation({ ...request, guests: 4 })).toMatchObject({ ok: true });
  });

  it('never seats more than the slot holds when many guests race for the last covers', async () => {
    // 16 covers at 19:00; 10 held. Twelve parties of two race for the last 6.
    await sql(
      `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source)
       VALUES ('FC-HELD0001', 'taya-house', '2026-10-02', '19:00', 'Dinner', 10, 'Held', 'x', '+84905999999', 'web')`,
    );
    await warmPool(5);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => submitReservation({ ...request, phone: phone(i) })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results.filter((r) => !r.ok).map((r) => (r.ok ? '' : r.code))).toEqual(Array(9).fill('full'));
    const { rows } = await sql(
      `SELECT sum(guests)::int AS covers FROM reservations WHERE reserved_at = '19:00' AND status IN ('requested', 'confirmed', 'seated')`,
    );
    expect(rows[0].covers).toBe(16);
  });

  it('waits for another instance holding the (restaurant, date) lock, then re-reads the covers', async () => {
    // A second pool plays a second server instance. It takes the same advisory
    // lock, fills the slot and commits; the guest's request must queue behind
    // it and then see the slot full. Another date is not held up.
    const { Pool } = await import('pg');
    const other = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
    const holder = await other.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(`SELECT pg_advisory_xact_lock(hashtextextended('booking:' || $1 || ':' || $2, 0))`, ['taya-house', '2026-10-02']);
      let settled = false;
      const pending = submitReservation(request).finally(() => {
        settled = true;
      });
      expect(await submitReservation({ ...request, date: '2026-10-03' })).toMatchObject({ ok: true });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);
      await holder.query(
        `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source)
         VALUES ('FC-OTHER001', 'taya-house', '2026-10-02', '19:00', 'Dinner', 15, 'Other', 'x', '+84905888888', 'phone')`,
      );
      await holder.query('COMMIT');
      expect(await pending).toEqual({ ok: false, code: 'full' });
    } finally {
      holder.release();
      await other.end();
    }
  });

  it('turns the second of two simultaneous identical requests into duplicate', async () => {
    await warmPool(2);
    const [a, b] = await Promise.all([submitReservation(request), submitReservation({ ...request, phone: '+84905000000' })]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.ok)).toEqual({ ok: false, code: 'duplicate' });
  });

  it('draws a new reference when the first one is already taken, three times at most', async () => {
    await createWebReservation(parsed(), { makeReference: () => 'FC-AAAAAAAA' });
    const queue = ['FC-AAAAAAAA', 'FC-BBBBBBBB'];
    expect(await createWebReservation(parsed({ phone: phone(1) }), { makeReference: () => queue.shift() ?? 'FC-CCCCCCCC' })).toMatchObject({
      ok: true, reference: 'FC-BBBBBBBB',
    });
    await expect(createWebReservation(parsed({ phone: phone(2) }), { makeReference: () => 'FC-AAAAAAAA' })).rejects.toThrow(
      /reservations_reference_key/,
    );
    expect((await sql('SELECT count(*)::int AS n FROM reservation_events')).rows[0].n).toBe(2);
  });
});
