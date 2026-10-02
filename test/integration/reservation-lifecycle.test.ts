import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebReservation } from '@/lib/server/booking/create';
import { parseReservationInput, type ReservationRequest } from '@/lib/server/booking/input';
import {
  addReservationNote,
  createStaffReservation,
  editReservation,
  transitionReservation,
  type ReservationActor,
  type StaffBookingInput,
} from '@/lib/server/booking/reservations';
import { TEST_DATABASE_URL } from '../helpers/db';

/*
 * Spec §10.3 in the database: one transaction per change with its
 * reservation_events row (never audit_log, §7.4), optimistic locking on
 * version, "who changed it" on a conflict, the time windows, staff bookings
 * that may pass capacity only with a reason, edits re-checked against
 * capacity, and the one booking-day lock shared with the guest's submit.
 */

let pool: Pool;
const LAN: ReservationActor = { id: 'staff-lan', label: 'Lan (lan@furama.test)' };
const MAI: ReservationActor = { id: 'staff-mai', label: 'Mai (mai@furama.test)' };
// Friday 2 Oct 2026, 10:00 in Vietnam. Tàya House: Lunch 11:30–13:30 and Dinner 18:00–21:00, 16 covers a slot (seed).
const NOW = new Date('2026-10-02T10:00:00+07:00');
const at = (vn: string) => new Date(`${vn}+07:00`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Seed = { status?: string; date?: string; time?: string; guests?: number; phone?: string; restaurant?: string; source?: string };

/** Inserts a booking straight into the table; `db` may be a client inside an open transaction. */
async function seed(over: Seed = {}, db: Pool | PoolClient = pool): Promise<{ id: string; version: number }> {
  const phone = over.phone ?? `+849050${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`;
  const { rows } = await db.query<{ id: string; version: number }>(
    `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, phone_e164, status, meal, source)
     VALUES ('FC-' || upper(substr(md5(random()::text), 1, 8)), $1, $2::date, $3, $4, 'Nguyễn Minh Anh', $5, $5, $6,
             CASE WHEN $3 < '15:00' THEN 'Lunch' ELSE 'Dinner' END, $7)
     RETURNING id::text, version`,
    [over.restaurant ?? 'taya-house', over.date ?? '2026-10-05', over.time ?? '19:00', over.guests ?? 2, phone, over.status ?? 'requested', over.source ?? 'web'],
  );
  return rows[0];
}

const row = async (id: string) =>
  (
    await pool.query(
      `SELECT status, version, status_reason, confirmed_at IS NOT NULL AS confirmed, cancelled_at IS NOT NULL AS cancelled,
              over_capacity, updated_by, to_char(reserved_on, 'YYYY-MM-DD') AS date, reserved_at AS time, guests, meal, source
         FROM reservations WHERE id = $1`,
      [id],
    )
  ).rows[0];

const events = async (id: string) =>
  (
    await pool.query(
      `SELECT actor_kind, actor_id, actor_label, type, from_status, to_status, changes, reason
         FROM reservation_events WHERE reservation_id = $1 ORDER BY id`,
      [id],
    )
  ).rows;

const move = (id: string, version: number, to: string, reason: string | null = null, now = NOW) =>
  transitionReservation(pool, LAN, { id, version, to: to as never, reason, notifyGuest: false }, { now });

const booking = (over: Partial<StaffBookingInput> = {}): StaffBookingInput => ({
  restaurantId: 'taya-house',
  date: '2026-10-05',
  time: '19:00',
  guests: 2,
  name: 'Trần Văn Bình',
  phone: '0905 111 222',
  phoneE164: '+84905111222',
  email: null,
  note: null,
  locale: 'vi',
  source: 'phone',
  overCapacityReason: null,
  notifyGuest: false,
  ...over,
});

/** What the guest's drawer would send for 19:00 on 5 Oct at Tàya House, parsed as submitReservation parses it. */
function guestRequest(guests: number): ReservationRequest {
  const parsed = parseReservationInput({
    restaurant: 'taya-house',
    date: '2026-10-05',
    time: '19:00',
    guests,
    name: 'Khách Web',
    phone: '0905 444 555',
    email: '',
    note: '',
    locale: 'en',
  });
  if (!parsed.ok) throw new Error(parsed.code);
  return parsed.value;
}

/** A pool whose transactions stop just before writing their event, until let go: a guest's submit caught holding its lock. */
function pausingPool(base: Pool) {
  let letGo!: () => void;
  const gate = new Promise<void>((resolve) => (letGo = resolve));
  let reached!: () => void;
  const paused = new Promise<void>((resolve) => (reached = resolve));
  const paused$ = {
    connect: async () => {
      const client = await base.connect();
      return {
        query: async (text: string, values?: unknown[]) => {
          if (text.startsWith('INSERT INTO reservation_events')) {
            reached();
            await gate;
          }
          return client.query(text, values);
        },
        release: () => client.release(),
      };
    },
  } as unknown as Pool;
  return { pool: paused$, paused, letGo };
}

/**
 * Another write holding a restaurant-day, in raw SQL with the key lib/server/booking/lock.ts uses
 * ('booking:<id>:<date>'), so this also pins the key's format. release() rolls back if still open.
 */
async function holdDay(restaurantId: string, date: string) {
  const client = await pool.connect();
  let open = false;
  try {
    await client.query('BEGIN');
    open = true;
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`booking:${restaurantId}:${date}`]);
  } catch (err) {
    if (open) await client.query('ROLLBACK');
    client.release();
    throw err;
  }
  return {
    client,
    commit: async () => {
      await client.query('COMMIT');
      open = false;
    },
    release: async () => {
      if (open) await client.query('ROLLBACK');
      open = false;
      client.release();
    },
  };
}

describe.skipIf(!TEST_DATABASE_URL)('reservation lifecycle (database)', () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 6 });
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE reservations, reservation_events, reservation_notes, closures, audit_log CASCADE');
    await pool.query('UPDATE restaurants SET booking_enabled = true, window_days = NULL, lead_minutes = NULL, max_party = NULL, auto_confirm = NULL');
    await pool.query('UPDATE booking_settings SET window_days = 14, lead_minutes = 30, same_day_cutoff = NULL, max_party = 12, auto_confirm = false');
    await pool.query(`UPDATE service_periods SET active = true WHERE restaurant_id = 'taya-house'`);
  });

  describe('transitions', () => {
    it('confirms: one UPDATE (version bumped by the trigger) and one event, in the same transaction', async () => {
      const r = await seed();
      expect(await move(r.id, r.version, 'confirmed')).toEqual({ ok: true, data: { status: 'confirmed', version: r.version + 1 } });
      expect(await row(r.id)).toMatchObject({ status: 'confirmed', version: r.version + 1, confirmed: true, updated_by: LAN.id });
      expect(await events(r.id)).toEqual([
        { actor_kind: 'staff', actor_id: LAN.id, actor_label: LAN.label, type: 'status_changed', from_status: 'requested', to_status: 'confirmed', changes: null, reason: null },
      ]);
    });

    it('cancels and declines only with a reason, which the booking keeps for the guest email', async () => {
      const a = await seed();
      expect(await move(a.id, a.version, 'cancelled')).toEqual({ ok: false, code: 'invalid', fieldErrors: { reason: ['Nhập lý do.'] } });
      expect(await move(a.id, a.version, 'cancelled', 'Khách gọi báo hủy')).toMatchObject({ ok: true });
      expect(await row(a.id)).toMatchObject({ status: 'cancelled', status_reason: 'Khách gọi báo hủy', cancelled: true });
      const b = await seed();
      expect(await move(b.id, b.version, 'declined', 'Hết bàn ngoài trời')).toMatchObject({ ok: true });
      expect((await events(b.id))[0]).toMatchObject({ to_status: 'declined', reason: 'Hết bàn ngoài trời' });
    });

    it('refuses transitions that are not in the map, and leaves no trace', async () => {
      const r = await seed({ status: 'cancelled' });
      expect(await move(r.id, r.version, 'confirmed')).toEqual({ ok: false, code: 'not_allowed' });
      const s = await seed();
      expect(await move(s.id, s.version, 'no_show')).toEqual({ ok: false, code: 'not_allowed' });
      expect(await move('999999', 1, 'confirmed')).toEqual({ ok: false, code: 'not_found' });
      expect(await events(r.id)).toEqual([]);
      expect((await row(s.id)).version).toBe(s.version);
    });

    it('a stale version is a conflict that names who changed it first', async () => {
      const r = await seed();
      await transitionReservation(pool, MAI, { id: r.id, version: r.version, to: 'confirmed', reason: null, notifyGuest: false }, { now: NOW });
      const stale = await move(r.id, r.version, 'cancelled', 'Trùng');
      expect(stale).toMatchObject({ ok: false, code: 'conflict', params: { by: MAI.label } });
      expect((stale as unknown as { params: { at: string } }).params.at).toMatch(/^\d{2}:\d{2} \d{2}\/\d{2}\/\d{4}$/);
      expect(await row(r.id)).toMatchObject({ status: 'confirmed' });
    });

    it('a note added after the change does not take the blame for the conflict', async () => {
      const HOA: ReservationActor = { id: 'staff-hoa', label: 'Hoa (hoa@furama.test)' };
      const r = await seed();
      await transitionReservation(pool, MAI, { id: r.id, version: r.version, to: 'confirmed', reason: null, notifyGuest: false }, { now: NOW });
      await addReservationNote(pool, HOA, { id: r.id, body: 'Khách dị ứng tôm' });
      expect(await move(r.id, r.version, 'cancelled', 'Trùng')).toMatchObject({ ok: false, code: 'conflict', params: { by: MAI.label } });
    });

    it('two people acting at once: exactly one wins, the other gets the conflict naming the winner', async () => {
      const r = await seed();
      const [a, b] = await Promise.all([
        transitionReservation(pool, LAN, { id: r.id, version: r.version, to: 'confirmed', reason: null, notifyGuest: false }, { now: NOW }),
        transitionReservation(pool, MAI, { id: r.id, version: r.version, to: 'declined', reason: 'Kín chỗ', notifyGuest: false }, { now: NOW }),
      ]);
      expect([a.ok, b.ok].sort()).toEqual([false, true]);
      const loser = (a.ok ? b : a) as unknown as { code: string; params: { by: string } };
      expect(loser.code).toBe('conflict');
      expect(loser.params.by).toBe(a.ok ? LAN.label : MAI.label);
      expect(await events(r.id)).toHaveLength(1);
    });

    it('"Đã đến" from 60 minutes before the sitting; no-show only 15 minutes after', async () => {
      const r = await seed({ status: 'confirmed', date: '2026-10-02', time: '19:00' });
      expect(await move(r.id, r.version, 'seated', null, at('2026-10-02T17:59'))).toEqual({ ok: false, code: 'too_early' });
      expect(await move(r.id, r.version, 'no_show', null, at('2026-10-02T19:14'))).toEqual({ ok: false, code: 'too_early' });
      expect(await move(r.id, r.version, 'no_show', null, at('2026-10-02T19:15'))).toMatchObject({ ok: true, data: { status: 'no_show' } });
      const s = await seed({ status: 'confirmed', date: '2026-10-02', time: '19:00' });
      expect(await move(s.id, s.version, 'seated', null, at('2026-10-02T18:00'))).toMatchObject({ ok: true, data: { status: 'seated' } });
    });

    it('corrections (no-show → seated, seated → confirmed) only on the same service day', async () => {
      const r = await seed({ status: 'no_show', date: '2026-10-02', time: '21:00' });
      expect(await move(r.id, r.version, 'seated', null, at('2026-10-03T04:00'))).toEqual({ ok: false, code: 'too_late' });
      const ok = await move(r.id, r.version, 'seated', 'Khách đến muộn', at('2026-10-03T00:30'));
      expect(ok).toMatchObject({ ok: true, data: { status: 'seated' } });
      const v = (ok as { data: { version: number } }).data.version;
      expect(await move(r.id, v, 'confirmed', null, at('2026-10-03T01:00'))).toMatchObject({ ok: true, data: { status: 'confirmed' } });
      expect((await events(r.id)).map((e) => `${e.from_status}→${e.to_status}`)).toEqual(['no_show→seated', 'seated→confirmed']);
    });

    it('answers duplicate when a correction puts a booking back beside an active one with the same phone', async () => {
      const seated = await seed({ status: 'seated', date: '2026-10-02', phone: '+84905777888' });
      // Seated is outside reservations_dedupe_v2_idx, so a second active booking with that phone could be made.
      await seed({ status: 'confirmed', date: '2026-10-02', phone: '+84905777888' });
      expect(await move(seated.id, seated.version, 'confirmed', null, at('2026-10-02T20:00'))).toEqual({ ok: false, code: 'duplicate' });
      expect(await row(seated.id)).toMatchObject({ status: 'seated', version: seated.version });
      expect(await events(seated.id)).toEqual([]);
    });

    it('runs the phase-5 hook inside the transaction, with the transition’s guest email', async () => {
      const r = await seed();
      const afterTransition = vi.fn(async (client: PoolClient, change: { reservationId: string }) => {
        // Same transaction: the hook sees the new status before COMMIT.
        const { rows } = await client.query('SELECT status FROM reservations WHERE id = $1', [change.reservationId]);
        expect(rows[0].status).toBe('confirmed');
      });
      await transitionReservation(pool, LAN, { id: r.id, version: r.version, to: 'confirmed', reason: null, notifyGuest: true }, { now: NOW, effects: { afterTransition } });
      expect(afterTransition).toHaveBeenCalledTimes(1);
      expect(afterTransition.mock.calls[0][1]).toMatchObject({
        reservationId: r.id,
        notifyGuest: true,
        transition: { from: 'requested', to: 'confirmed', guestEmail: { event: 'guest.confirmed', when: 'always' } },
      });

      // A hook that throws rolls the whole change back (an outbox row is never lost or orphaned).
      const s = await seed();
      await expect(
        transitionReservation(pool, LAN, { id: s.id, version: s.version, to: 'confirmed', reason: null, notifyGuest: false }, {
          now: NOW,
          effects: { afterTransition: async () => Promise.reject(new Error('outbox down')) },
        }),
      ).rejects.toThrow('outbox down');
      expect(await row(s.id)).toMatchObject({ status: 'requested', version: s.version });
      expect(await events(s.id)).toEqual([]);
    });
  });

  describe('staff bookings', () => {
    it('a phone booking is confirmed, a walk-in seated; each starts its timeline with created', async () => {
      const phone = await createStaffReservation(pool, LAN, booking(), { now: NOW });
      expect(phone).toMatchObject({ ok: true, data: { reference: expect.stringMatching(/^FC-[0-9A-HJKMNP-TV-Z]{8}$/) } });
      const id = (phone as { data: { id: string } }).data.id;
      expect(await row(id)).toMatchObject({ status: 'confirmed', confirmed: true, meal: 'Dinner', over_capacity: false, source: 'phone' });
      expect(await events(id)).toEqual([
        { actor_kind: 'staff', actor_id: LAN.id, actor_label: LAN.label, type: 'created', from_status: null, to_status: 'confirmed', changes: { source: 'phone' }, reason: null },
      ]);
      const walkIn = await createStaffReservation(pool, LAN, booking({ source: 'walk_in', date: '2026-10-02', time: '12:00' }), { now: NOW });
      expect(await row((walkIn as { data: { id: string } }).data.id)).toMatchObject({ status: 'seated', meal: 'Lunch', source: 'walk_in' });
    });

    it('a walk-in is for the service day only; a phone booking not in the past', async () => {
      expect(await createStaffReservation(pool, LAN, booking({ source: 'walk_in' }), { now: NOW })).toMatchObject({
        ok: false,
        code: 'invalid',
        fieldErrors: { date: ['Khách vãng lai chỉ tạo cho hôm nay.'] },
      });
      expect(await createStaffReservation(pool, LAN, booking({ date: '2026-10-01' }), { now: NOW })).toMatchObject({
        ok: false,
        code: 'invalid',
        fieldErrors: { date: ['Ngày đã qua.'] },
      });
      expect(await createStaffReservation(pool, LAN, booking({ date: '2026-10-02', time: '12:00' }), { now: at('2026-10-02T20:00') })).toMatchObject({
        ok: false,
        code: 'invalid',
        fieldErrors: { time: ['Giờ này đã qua. Khách đang có mặt thì tạo khách vãng lai.'] },
      });
    });

    it('books past the online window, with online booking off and above max_party: those rules are the guest’s', async () => {
      await pool.query(`UPDATE restaurants SET booking_enabled = false, window_days = 1, max_party = 2 WHERE id = 'taya-house'`);
      const result = await createStaffReservation(pool, LAN, booking({ date: '2026-11-20', guests: 6 }), { now: NOW });
      expect(result).toMatchObject({ ok: true });
      expect(await row((result as { data: { id: string } }).data.id)).toMatchObject({ date: '2026-11-20', guests: 6, status: 'confirmed' });
    });

    it('past a slot’s capacity only with a reason, which is kept on the created event', async () => {
      await seed({ status: 'confirmed', guests: 15 });
      expect(await createStaffReservation(pool, LAN, booking(), { now: NOW })).toEqual({ ok: false, code: 'full', params: { left: '1' } });
      const over = await createStaffReservation(pool, LAN, booking({ overCapacityReason: 'Khách quen, kê thêm bàn' }), { now: NOW });
      const id = (over as { data: { id: string } }).data.id;
      expect(await row(id)).toMatchObject({ over_capacity: true });
      expect((await events(id))[0]).toMatchObject({ changes: { source: 'phone', over_capacity: true }, reason: 'Khách quen, kê thêm bàn' });
    });

    it('not on a closed service, nor at a time that is not a slot', async () => {
      await pool.query(
        `INSERT INTO closures (scope, restaurant_id, starts_on, ends_on, meals) VALUES ('restaurant', 'taya-house', '2026-10-05', '2026-10-05', '{Dinner}')`,
      );
      expect(await createStaffReservation(pool, LAN, booking(), { now: NOW })).toEqual({ ok: false, code: 'closed' });
      expect(await createStaffReservation(pool, LAN, booking({ time: '12:15' }), { now: NOW })).toEqual({ ok: false, code: 'slot_unavailable' });
      expect(await createStaffReservation(pool, LAN, booking({ time: '12:00' }), { now: NOW })).toMatchObject({ ok: true });
    });

    it('a duplicate phone at the same table and time is refused', async () => {
      await createStaffReservation(pool, LAN, booking(), { now: NOW });
      expect(await createStaffReservation(pool, LAN, booking({ phone: '+84 905 111 222' }), { now: NOW })).toEqual({ ok: false, code: 'duplicate' });
    });

    it('concurrent bookings never exceed capacity (the booking-day lock)', async () => {
      // 16 covers at 19:00; eight parties of 3 race for them: five fit (15 covers).
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          createStaffReservation(pool, i % 2 ? LAN : MAI, booking({ guests: 3, phone: `0905 222 33${i}`, phoneE164: `+8490522233${i}` }), { now: NOW }),
        ),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(5);
      expect(results.filter((r) => !r.ok).map((r) => (r as { code: string }).code)).toEqual(['full', 'full', 'full']);
      const { rows } = await pool.query(`SELECT sum(guests)::int AS covers FROM reservations WHERE reserved_at = '19:00'`);
      expect(rows[0].covers).toBe(15);
    });

    it('redraws a reference that collides', async () => {
      const first = await createStaffReservation(pool, LAN, booking(), { now: NOW, makeReference: () => 'FC-AAAAAAAA' });
      expect(first).toMatchObject({ ok: true });
      const queue = ['FC-AAAAAAAA', 'FC-BBBBBBBB'];
      const second = await createStaffReservation(pool, LAN, booking({ phone: '0905 999 000', phoneE164: '+84905999000' }), {
        now: NOW,
        makeReference: () => queue.shift() ?? 'FC-CCCCCCCC',
      });
      expect(second).toMatchObject({ ok: true, data: { reference: 'FC-BBBBBBBB' } });
    });
  });

  describe('one lock for guest and staff writes', () => {
    it('a staff booking waits while a guest’s submit holds the restaurant-day, then counts the guest’s covers', async () => {
      await seed({ status: 'confirmed', guests: 14 }); // 19:00 on 5 Oct: 2 of 16 covers left
      const guest = pausingPool(pool);
      const submitted = createWebReservation(guestRequest(2), { now: NOW, pool: guest.pool });
      await guest.paused; // the guest holds the lock; its 2 covers are inserted, not committed
      let settled = false;
      const staff = createStaffReservation(pool, LAN, booking({ guests: 1 }), { now: NOW }).finally(() => {
        settled = true;
      });
      try {
        await sleep(300);
        expect(settled).toBe(false);
      } finally {
        // Always let go: a stuck transaction would hold its locks into the next test.
        guest.letGo();
      }
      expect(await submitted).toMatchObject({ ok: true, status: 'requested' });
      expect(await staff).toEqual({ ok: false, code: 'full', params: { left: '0' } });
    });

    it('a guest’s submit waits while a staff booking holds the restaurant-day, then answers full', async () => {
      await seed({ status: 'confirmed', guests: 13 }); // 3 left
      let letGo!: () => void;
      const gate = new Promise<void>((resolve) => (letGo = resolve));
      let reached!: () => void;
      const inside = new Promise<void>((resolve) => (reached = resolve));
      const staff = createStaffReservation(pool, LAN, booking({ guests: 2 }), {
        now: NOW,
        effects: {
          afterCreate: async () => {
            reached();
            await gate;
          },
        },
      });
      await inside; // the staff booking holds the lock, its 2 covers inserted
      let settled = false;
      const guest = createWebReservation(guestRequest(2), { now: NOW, pool }).finally(() => {
        settled = true;
      });
      try {
        await sleep(300);
        expect(settled).toBe(false);
      } finally {
        letGo();
      }
      expect(await staff).toMatchObject({ ok: true });
      expect(await guest).toEqual({ ok: false, code: 'full' });
      const { rows } = await pool.query(`SELECT sum(guests)::int AS covers FROM reservations WHERE reserved_at = '19:00'`);
      expect(rows[0].covers).toBe(15);
    });
  });

  describe('edits', () => {
    const edit = (id: string, version: number, over: Record<string, unknown> = {}) =>
      editReservation(
        pool,
        LAN,
        {
          id,
          version,
          date: '2026-10-05',
          time: '19:00',
          guests: 2,
          name: 'Nguyễn Minh Anh',
          phone: '+84905000001',
          phoneE164: '+84905000001',
          email: null,
          note: null,
          overCapacityReason: null,
          ...over,
        },
      );

    it('records only what changed, as [before, after]', async () => {
      const r = await seed({ phone: '+84905000001' });
      const result = await edit(r.id, r.version, { time: '19:30', guests: 4, note: 'Ghế em bé' });
      expect(result).toEqual({ ok: true, data: { version: r.version + 1, changed: true } });
      expect((await events(r.id))[0]).toMatchObject({
        type: 'edited',
        changes: { time: ['19:00', '19:30'], guests: [2, 4], note: [null, 'Ghế em bé'] },
      });
      // The same values again: no UPDATE (each one would bump the version), no event.
      expect(await edit(r.id, r.version + 1, { time: '19:30', guests: 4, note: 'Ghế em bé' })).toEqual({
        ok: true,
        data: { version: r.version + 1, changed: false },
      });
      expect(await events(r.id)).toHaveLength(1);
    });

    it('re-checks capacity when the party grows or moves, not counting itself', async () => {
      const r = await seed({ phone: '+84905000001', guests: 10 });
      await seed({ status: 'confirmed', guests: 6 }); // 19:00 is now full (16)
      expect(await edit(r.id, r.version, { guests: 9 })).toMatchObject({ ok: true }); // smaller: no check
      const v = (await row(r.id)).version;
      // 16 covers less the other party's 6: ten left for this one, which now wants eleven.
      expect(await edit(r.id, v, { guests: 11 })).toEqual({ ok: false, code: 'full', params: { left: '10' } });
      expect(await edit(r.id, v, { guests: 11, overCapacityReason: 'Bàn ghép' })).toMatchObject({ ok: true });
      expect(await row(r.id)).toMatchObject({ guests: 11, over_capacity: true });
      expect(await edit(r.id, v, { time: '20:00' })).toMatchObject({ ok: false, code: 'conflict' });
    });

    it('a guest’s web booking edited past capacity with a reason: over capacity, the reason on the edited event', async () => {
      const r = await seed({ phone: '+84905000001', source: 'web' });
      await seed({ status: 'confirmed', guests: 14 });
      expect(await edit(r.id, r.version, { guests: 4 })).toEqual({ ok: false, code: 'full', params: { left: '2' } });
      expect(await edit(r.id, r.version, { guests: 4, overCapacityReason: 'Khách gọi thêm người' })).toMatchObject({ ok: true });
      expect(await row(r.id)).toMatchObject({ guests: 4, over_capacity: true, source: 'web' });
      expect((await events(r.id))[0]).toMatchObject({
        type: 'edited',
        changes: { guests: [2, 4], over_capacity: [false, true] },
        reason: 'Khách gọi thêm người',
      });
    });

    it('moves a booking to another day only into an open slot', async () => {
      const r = await seed({ phone: '+84905000001' });
      await pool.query(
        `INSERT INTO closures (scope, restaurant_id, starts_on, ends_on, meals) VALUES ('restaurant', 'taya-house', '2026-10-06', '2026-10-06', NULL)`,
      );
      expect(await edit(r.id, r.version, { date: '2026-10-06' })).toEqual({ ok: false, code: 'closed' });
      expect(await edit(r.id, r.version, { date: '2026-10-07', time: '19:10' })).toEqual({ ok: false, code: 'slot_unavailable' });
      expect(await edit(r.id, r.version, { date: '2026-10-07', time: '12:00' })).toMatchObject({ ok: true });
      expect(await row(r.id)).toMatchObject({ date: '2026-10-07', time: '12:00', meal: 'Lunch' });
    });

    it('not for a booking that no longer holds seats', async () => {
      const r = await seed({ status: 'cancelled', phone: '+84905000001' });
      expect(await edit(r.id, r.version, { guests: 3 })).toEqual({ ok: false, code: 'not_allowed' });
    });

    // Code rule 1: an edit that moves or grows a booking takes the target day's booking-day lock before it
    // counts covers, or it would read the slot before another write's covers commit and overfill it.
    it('a move into another day waits for that day’s lock, then counts what the holder booked', async () => {
      const r = await seed({ phone: '+84905000001' }); // 2 guests at 19:00 on 5 Oct
      const holder = await holdDay('taya-house', '2026-10-06');
      let edited: Promise<unknown> | undefined;
      try {
        // The holder fills 19:00 on 6 Oct (16 of 16 covers), not committed yet.
        await seed({ date: '2026-10-06', status: 'confirmed', guests: 16 }, holder.client);
        let settled = false;
        edited = edit(r.id, r.version, { date: '2026-10-06' }).finally(() => {
          settled = true;
        });
        await sleep(300);
        expect(settled).toBe(false);
        await holder.commit();
        expect(await edited).toEqual({ ok: false, code: 'full', params: { left: '0' } });
        expect(await row(r.id)).toMatchObject({ date: '2026-10-05', time: '19:00', guests: 2, version: r.version });
      } finally {
        // Always end the holder: a stuck transaction would keep its lock into the next test.
        await holder.release();
        await edited?.catch(() => {});
      }
    });

    it('a larger party on the same day waits for the day’s lock, then counts what the holder booked', async () => {
      const r = await seed({ phone: '+84905000001' }); // 2 guests at 19:00 on 5 Oct
      const holder = await holdDay('taya-house', '2026-10-05');
      let edited: Promise<unknown> | undefined;
      try {
        // The holder books 14 more at 19:00 on 5 Oct, not committed yet: with this booking's 2, 16 of 16.
        await seed({ status: 'confirmed', guests: 14 }, holder.client);
        let settled = false;
        edited = edit(r.id, r.version, { guests: 3 }).finally(() => {
          settled = true;
        });
        await sleep(300);
        expect(settled).toBe(false);
        await holder.commit();
        expect(await edited).toEqual({ ok: false, code: 'full', params: { left: '2' } });
        expect(await row(r.id)).toMatchObject({ guests: 2, version: r.version });
      } finally {
        await holder.release();
        await edited?.catch(() => {});
      }
    });
  });

  it('a note is internal: its own table, and the timeline only says one was added', async () => {
    const r = await seed();
    const note = await addReservationNote(pool, LAN, { id: r.id, body: 'Khách dị ứng tôm' });
    expect(note).toMatchObject({ ok: true });
    const { rows } = await pool.query('SELECT author_id, author_label, body FROM reservation_notes WHERE reservation_id = $1', [r.id]);
    expect(rows).toEqual([{ author_id: LAN.id, author_label: LAN.label, body: 'Khách dị ứng tôm' }]);
    const [event] = await events(r.id);
    expect(event).toMatchObject({ type: 'note_added', changes: { note_id: (note as { data: { noteId: string } }).data.noteId } });
    expect(JSON.stringify(event)).not.toContain('tôm');
    expect((await row(r.id)).version).toBe(r.version); // a note does not touch the booking
    expect(await addReservationNote(pool, LAN, { id: '999999', body: 'x' })).toEqual({ ok: false, code: 'not_found' });
  });

  it('writes the timeline instead of audit_log (spec §7.4)', async () => {
    const created = await createStaffReservation(pool, LAN, booking(), { now: NOW });
    const id = (created as { data: { id: string } }).data.id;
    await editReservation(
      pool,
      LAN,
      { id, version: 1, date: '2026-10-05', time: '19:30', guests: 2, name: 'Trần Văn Bình', phone: '0905 111 222', phoneE164: '+84905111222', email: null, note: null, overCapacityReason: null },
    );
    await move(id, 2, 'cancelled', 'Khách hủy');
    await addReservationNote(pool, LAN, { id, body: 'Đã gọi lại' });
    expect((await events(id)).map((e) => e.type)).toEqual(['created', 'edited', 'status_changed', 'note_added']);
    expect((await pool.query('SELECT count(*)::int AS n FROM audit_log')).rows[0].n).toBe(0);
  });
});
