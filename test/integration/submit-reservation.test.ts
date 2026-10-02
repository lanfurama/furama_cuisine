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
import { PRIVACY_POLICY_VERSION } from '@/lib/legal';
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
  consent: true,
  honeypot: '',
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

  describe('step 1: bots are refused before anything is read or written', () => {
    const count = async () => (await sql('SELECT count(*)::int AS n FROM reservations')).rows[0].n;

    it('a filled honeypot answers bot_blocked, and the log names only the check', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        expect(await submitReservation({ ...request, honeypot: 'https://cheap-pills.example' })).toEqual({ ok: false, code: 'bot_blocked' });
        expect(warn).toHaveBeenCalledWith('[booking] refused as a bot', { by: 'honeypot' });
        expect(JSON.stringify(warn.mock.calls)).not.toContain('0905');
      } finally {
        warn.mockRestore();
      }
      expect(await count()).toBe(0);
      expect(afterTasks).toHaveLength(0);
    });

    it('comes before zod: a bot gets bot_blocked, never a hint about which field was wrong', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(await submitReservation({ honeypot: 'x', name: 'A' })).toEqual({ ok: false, code: 'bot_blocked' });
      warn.mockRestore();
    });
  });

  describe('consent (spec §11)', () => {
    it('without the box ticked nothing is booked', async () => {
      expect(await submitReservation({ ...request, consent: false })).toEqual({ ok: false, code: 'consent_required' });
      const { consent: _c, ...unticked } = request;
      expect(await submitReservation(unticked)).toEqual({ ok: false, code: 'consent_required' });
      expect((await sql('SELECT count(*)::int AS n FROM reservations')).rows[0].n).toBe(0);
    });

    it('the booking keeps which policy the guest agreed to, and when', async () => {
      await submitReservation(request);
      // Fake timers move Date only: the database's now() is the real time.
      const { rows } = await sql(`SELECT consent_version, consented_at > now() - interval '1 minute' AS recent FROM reservations`);
      expect(rows).toEqual([{ consent_version: PRIVACY_POLICY_VERSION, recent: true }]);
    });

    it('the database keeps the version and the time together (reservations_consent_check)', async () => {
      const insert = (version: string | null, at: string | null) =>
        sql(
          `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source, consent_version, consented_at)
           VALUES ('FC-CONSENT1', 'taya-house', '2026-10-02', '19:00', 'Dinner', 2, 'G', 'x', '+84905123123', 'web', $1, $2)`,
          [version, at],
        );
      await expect(insert('2026-10-02', null)).rejects.toMatchObject({ code: '23514', constraint: 'reservations_consent_check' });
      await expect(insert(null, '2026-10-02T00:00:00Z')).rejects.toMatchObject({ code: '23514' });
      await expect(insert('', '2026-10-02T00:00:00Z')).rejects.toMatchObject({ code: '23514' });
      await insert(null, null); // a staff-entered or older booking
    });
  });

  describe('step 5: at most three active web requests per phone number per date', () => {
    const DINNERS = ['taya-house', 'the-fan', 'don-ciprianis', 'danaksara', 'pho-cuon', 'hura-izakaya'];
    const at = (restaurant: string, over: Partial<typeof request> = {}) => submitReservation({ ...request, restaurant, ...over });

    it('the fourth, at any restaurant, answers too_many_requests; another date, or another number, still books', async () => {
      for (const r of DINNERS.slice(0, 3)) expect(await at(r)).toMatchObject({ ok: true });
      // The same number written another way is the same number (phone_e164).
      expect(await at(DINNERS[3], { phone: '+84 905 000 000' })).toEqual({ ok: false, code: 'too_many_requests' });
      expect(await at(DINNERS[3], { time: '12:00' })).toEqual({ ok: false, code: 'too_many_requests' }); // lunch, same date
      expect(await at(DINNERS[3], { date: '2026-10-03' })).toMatchObject({ ok: true });
      expect(await at(DINNERS[3], { phone: '0905 000 001' })).toMatchObject({ ok: true });
    });

    it('comes before the rule checks: a fifth request for a closed sitting still hears about the limit', async () => {
      for (const r of DINNERS.slice(0, 3)) await at(r);
      expect(await at(DINNERS[3], { time: '15:00' })).toEqual({ ok: false, code: 'too_many_requests' });
    });

    it('cancelling one frees a place', async () => {
      for (const r of DINNERS.slice(0, 3)) await at(r);
      await sql(`UPDATE reservations SET status = 'cancelled', cancelled_at = now() WHERE restaurant_id = $1`, [DINNERS[0]]);
      expect(await at(DINNERS[3])).toMatchObject({ ok: true });
    });

    it('counts only requested and confirmed web bookings of that date and number', async () => {
      const seed = (i: number, over: { status?: string; source?: string; day?: string; e164?: string }) =>
        sql(
          `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source, status, consent_version, consented_at)
           VALUES ($1, 'yum-food-village', $2, $3, 'Dinner', 2, 'G', 'x', $4, $5, $6, CASE WHEN $5 = 'web' THEN 'v' END, CASE WHEN $5 = 'web' THEN now() END)`,
          [`FC-LIMIT00${i}`, over.day ?? '2026-10-02', `18:${String(i * 5).padStart(2, '0')}`, over.e164 ?? '+84905000000', over.source ?? 'web', over.status ?? 'requested'],
        );
      await seed(1, { status: 'cancelled' });
      await seed(2, { status: 'declined' });
      await seed(3, { status: 'seated' });
      await seed(4, { status: 'no_show' });
      await seed(5, { source: 'phone', status: 'confirmed' }); // staff-entered: not a web request
      await seed(6, { day: '2026-10-03' });
      await seed(7, { e164: '+84905000009' });
      await seed(8, { status: 'confirmed' }); // this one counts
      expect(await at(DINNERS[0])).toMatchObject({ ok: true });
      expect(await at(DINNERS[1])).toMatchObject({ ok: true });
      expect(await at(DINNERS[2])).toEqual({ ok: false, code: 'too_many_requests' });
    });

    it('holds when one number books six restaurants at once (the guest-phone lock; the booking-day locks differ)', async () => {
      await warmPool(5);
      const results = await Promise.all(DINNERS.map((r) => at(r)));
      expect(results.filter((r) => r.ok)).toHaveLength(3);
      expect(results.filter((r) => !r.ok).map((r) => (r.ok ? '' : r.code))).toEqual(Array(3).fill('too_many_requests'));
      const { rows } = await sql(`SELECT count(*)::int AS n FROM reservations WHERE phone_e164 = '+84905000000'`);
      expect(rows[0].n).toBe(3);
    });

    it('a number waiting on its own lock holds up no one else at that restaurant and date', async () => {
      // Another instance holds the guest-phone lock of +84905000000 for 2 Oct (same key format as lock.ts).
      const { Pool } = await import('pg');
      const other = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
      const holder = await other.connect();
      try {
        await holder.query('BEGIN');
        await holder.query(`SELECT pg_advisory_xact_lock(hashtextextended('guest-phone:' || $1 || ':' || $2, 0))`, ['+84905000000', '2026-10-02']);
        let settled = false;
        const waiting = submitReservation(request).finally(() => {
          settled = true;
        });
        // A different number, same restaurant, same date and time: not held up.
        expect(await submitReservation({ ...request, phone: '0905 000 002' })).toMatchObject({ ok: true });
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(settled).toBe(false);
        await holder.query('COMMIT');
        expect(await waiting).toMatchObject({ ok: true });
      } finally {
        holder.release();
        await other.end();
      }
    });
  });
});
