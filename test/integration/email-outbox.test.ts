import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebReservation } from '@/lib/server/booking/create';
import { parseReservationInput } from '@/lib/server/booking/input';
import { createStaffReservation, transitionReservation, type ReservationActor, type StaffBookingInput } from '@/lib/server/booking/reservations';
import { outboxEnv } from '@/lib/server/email/env';
import { outboxEffects } from '@/lib/server/email/outbox';
import { TEST_DATABASE_URL } from '../helpers/db';

/*
 * Spec §10.3–10.4 in the database: which change queues which email to whom,
 * written in the change's own transaction (one row per recipient). Nothing
 * here sends; the drain's half of this file arrives with the drain.
 */

let pool: Pool;
const LAN: ReservationActor = { id: 'staff-lan', label: 'Lan (lan@furama.test)' };
// Friday 2 Oct 2026, 10:00 in Vietnam. Tàya House (destination resort): Dinner 18:00–21:00.
const NOW = new Date('2026-10-02T10:00:00+07:00');
let phoneSeq = 0;
const nextPhone = () => `0905 ${String(200000 + ++phoneSeq).slice(0, 3)} ${String(200000 + phoneSeq).slice(3)}`;

async function guestBooking(over: Record<string, unknown> = {}) {
  const parsed = parseReservationInput({
    restaurant: 'taya-house', date: '2026-10-05', time: '19:00', guests: 2, name: 'Khách Web',
    phone: nextPhone(), email: 'guest@example.com', note: '', locale: 'en', ...over,
  });
  if (!parsed.ok) throw new Error(parsed.code);
  const result = await createWebReservation(parsed.value, { now: NOW, pool });
  if (!result.ok) throw new Error(result.code);
  return result;
}

const staffBooking = (over: Partial<StaffBookingInput> = {}): StaffBookingInput => ({
  restaurantId: 'taya-house', date: '2026-10-05', time: '19:30', guests: 2, name: 'Trần Văn Bình', phone: '0905 111 222',
  phoneE164: '+84905111222', email: 'binh@example.com', note: null, locale: 'vi', source: 'phone', overCapacityReason: null,
  notifyGuest: true, ...over,
});

type Row = { id: string; event: string; audience: string; to_email: string; locale: string; fallback: boolean; status: string; attempts: number };
const outbox = async (where = 'true', values: unknown[] = []): Promise<Row[]> =>
  (await pool.query(`SELECT id::text, event, audience, to_email, locale, fallback, status, attempts FROM email_outbox WHERE ${where} ORDER BY id`, values)).rows;
const recipient = (over: Record<string, unknown>) => {
  const r = { scope: 'all', email: 'all@furama.test', ...over };
  const cols = Object.keys(r);
  return pool.query(`INSERT INTO notification_recipients (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(r));
};

describe.skipIf(!TEST_DATABASE_URL)('email outbox (database)', () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 8 });
  });
  afterAll(async () => {
    // Leave no recipient behind: the next file's bookings would email them instead of the general inbox.
    await pool.query('TRUNCATE email_outbox, notification_recipients');
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE reservations, reservation_events, reservation_notes, closures, email_outbox, notification_recipients CASCADE');
    await pool.query('UPDATE restaurants SET booking_enabled = true, window_days = NULL, lead_minutes = NULL, max_party = NULL, auto_confirm = NULL');
    await pool.query('UPDATE booking_settings SET window_days = 14, lead_minutes = 30, same_day_cutoff = NULL, max_party = 12, auto_confirm = false, guest_ack_email = true');
    await pool.query(`UPDATE site_settings SET email = 'fb@furamavietnam.com'`);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('queueing, in the transaction of the change', () => {
    it('a web booking queues staff.new for the restaurant, destination and all recipients (deduplicated), and guest.ack', async () => {
      await recipient({ scope: 'restaurant', restaurant_id: 'taya-house', email: 'taya@furama.test', locale: 'en' });
      await recipient({ scope: 'destination', destination_id: 'resort', email: 'Resort@Furama.test' });
      await recipient({ scope: 'all', email: 'resort@furama.test', locale: 'en' }); // the same inbox as above, another case
      await recipient({ scope: 'all', email: 'gm@furama.test' });
      await recipient({ scope: 'destination', destination_id: 'mm', email: 'mm@furama.test' }); // another destination
      await recipient({ scope: 'restaurant', restaurant_id: 'the-fan', email: 'fan@furama.test' }); // another restaurant
      await recipient({ scope: 'all', email: 'off@furama.test', active: false });

      const result = await guestBooking();
      const rows = await outbox();
      expect(rows.map(({ event, audience, to_email, locale, fallback, status, attempts }) => ({ event, audience, to_email, locale, fallback, status, attempts }))).toEqual([
        { event: 'staff.new', audience: 'staff', to_email: 'gm@furama.test', locale: 'vi', fallback: false, status: 'queued', attempts: 0 },
        // The destination row wins over the 'all' row for the same inbox: its spelling, its language.
        { event: 'staff.new', audience: 'staff', to_email: 'Resort@Furama.test', locale: 'vi', fallback: false, status: 'queued', attempts: 0 },
        { event: 'staff.new', audience: 'staff', to_email: 'taya@furama.test', locale: 'en', fallback: false, status: 'queued', attempts: 0 },
        { event: 'guest.ack', audience: 'guest', to_email: 'guest@example.com', locale: 'en', fallback: false, status: 'queued', attempts: 0 },
      ]);
      expect(result.outboxIds).toEqual(rows.map((r) => r.id));
      // Every row points at the booking and the created event of the same transaction, in this env.
      const links = await pool.query(
        `SELECT DISTINCT o.env, o.reservation_id::text AS r, e.type FROM email_outbox o JOIN reservation_events e ON e.id = o.reservation_event_id`,
      );
      expect(links.rows).toEqual([{ env: 'development', r: result.id, type: 'created' }]);
    });

    it('no recipient for the restaurant: staff.new goes to the general email (site_settings), in Vietnamese, marked fallback', async () => {
      await recipient({ scope: 'restaurant', restaurant_id: 'the-fan', email: 'fan@furama.test' });
      await pool.query(`UPDATE site_settings SET email = 'contact@furama.test'`);
      await guestBooking({ email: '' });
      expect(await outbox()).toMatchObject([{ event: 'staff.new', to_email: 'contact@furama.test', locale: 'vi', fallback: true }]);
    });

    it('guest.ack only while guest_ack_email is on; an auto-confirmed booking gets guest.confirmed instead; no address, no guest row', async () => {
      await pool.query('UPDATE booking_settings SET guest_ack_email = false');
      await guestBooking();
      expect((await outbox(`audience = 'guest'`)).length).toBe(0);
      await pool.query(`UPDATE booking_settings SET guest_ack_email = true; UPDATE restaurants SET auto_confirm = true WHERE id = 'taya-house'`);
      await guestBooking({ time: '19:30', locale: 'vi' });
      expect(await outbox(`audience = 'guest'`)).toMatchObject([{ event: 'guest.confirmed', locale: 'en' }]); // vi is not enabled: the booking is in en
      await guestBooking({ time: '20:00', email: '' });
      expect((await outbox(`audience = 'guest'`)).length).toBe(1);
    });

    it('an address the outbox would refuse (two @) never fails the booking: it books, without a guest email (R13)', async () => {
      const odd = await guestBooking({ email: 'an@home@example.com' });
      expect(odd.ok).toBe(true);
      expect((await outbox()).map((r) => r.event)).toEqual(['staff.new']);
      // A plain address full of letters a broken pattern could trip on ("s" for \s) is queued.
      await guestBooking({ time: '19:30', email: 'sassy.susan@ses.example.com' });
      expect(await outbox(`audience = 'guest'`)).toMatchObject([{ to_email: 'sassy.susan@ses.example.com' }]);
    });

    it('a refused booking (duplicate) queues nothing', async () => {
      await guestBooking({ phone: '0905 777 777' });
      const parsed = parseReservationInput({ restaurant: 'taya-house', date: '2026-10-05', time: '19:00', guests: 2, name: 'Khách Web', phone: '0905 777 777', email: 'x@example.com', note: '', locale: 'en' });
      if (!parsed.ok) throw new Error(parsed.code);
      expect(await createWebReservation(parsed.value, { now: NOW, pool })).toEqual({ ok: false, code: 'duplicate' });
      expect((await outbox()).map((r) => r.to_email)).toEqual(['fb@furamavietnam.com', 'guest@example.com']);
    });

    it('transitions (spec §10.3): confirm and decline always email the guest; cancel only with "Báo khách"; seated never', async () => {
      const move = async (id: string, to: string, notifyGuest: boolean, reason: string | null = null) => {
        const { rows } = await pool.query('SELECT version FROM reservations WHERE id = $1', [id]);
        const effects = outboxEffects('development');
        const result = await transitionReservation(pool, LAN, { id, version: rows[0].version, to: to as never, reason, notifyGuest }, { now: NOW, effects });
        expect(result.ok).toBe(true);
        return effects.queued;
      };
      const a = await guestBooking();
      const b = await guestBooking({ time: '19:30' });
      const c = await guestBooking({ time: '20:00' });
      await pool.query('DELETE FROM email_outbox');

      const confirmed = await move(a.id, 'confirmed', false);
      expect(await outbox()).toMatchObject([{ id: confirmed[0], event: 'guest.confirmed', to_email: 'guest@example.com' }]);
      expect(await move(b.id, 'declined', false, 'Kín bàn')).toHaveLength(1);
      expect(await move(c.id, 'cancelled', false, 'Khách gọi hủy')).toEqual([]);
      expect(await move(a.id, 'cancelled', true, 'Khách gọi hủy')).toHaveLength(1);
      expect((await outbox()).map((r) => r.event)).toEqual(['guest.confirmed', 'guest.declined', 'guest.cancelled']);
      // "Đã đến" sends nothing.
      const d = await guestBooking({ time: '18:00' });
      await pool.query('DELETE FROM email_outbox WHERE reservation_id = $1', [d.id]);
      await move(d.id, 'confirmed', false);
      await pool.query(`UPDATE reservations SET reserved_on = '2026-10-02', reserved_at = '10:30' WHERE id = $1`, [d.id]);
      expect(await move(d.id, 'seated', true)).toEqual([]);
    });

    it('staff bookings (R8): a phone booking with "Gửi email xác nhận" gets guest.confirmed; unticked, or a walk-in, nothing', async () => {
      const make = async (over: Partial<StaffBookingInput>) => {
        const effects = outboxEffects('development');
        const result = await createStaffReservation(pool, LAN, staffBooking(over), { now: NOW, effects });
        expect(result.ok).toBe(true);
        return effects.queued;
      };
      expect(await make({})).toHaveLength(1);
      expect(await make({ time: '20:00', phone: '0905 111 223', phoneE164: '+84905111223', notifyGuest: false })).toEqual([]);
      expect(await make({ source: 'walk_in', date: '2026-10-02', time: '12:00', phone: '0905 111 224', phoneE164: '+84905111224' })).toEqual([]);
      // staff.new is for web bookings only (R4): staff do not tell themselves.
      expect(await outbox()).toMatchObject([{ event: 'guest.confirmed', to_email: 'binh@example.com', locale: 'vi' }]);
    });

    it('a hook that fails rolls back the booking change and its rows together', async () => {
      const a = await guestBooking();
      await pool.query('DELETE FROM email_outbox');
      const { rows } = await pool.query('SELECT version FROM reservations WHERE id = $1', [a.id]);
      const effects = outboxEffects('development');
      const failing = {
        ...effects,
        afterTransition: async (...args: Parameters<typeof effects.afterTransition>) => {
          await effects.afterTransition(...args);
          throw new Error('boom after the outbox insert');
        },
      };
      await expect(
        transitionReservation(pool, LAN, { id: a.id, version: rows[0].version, to: 'confirmed', reason: null, notifyGuest: false }, { now: NOW, effects: failing }),
      ).rejects.toThrow('boom');
      expect(effects.queued).toHaveLength(1); // an id that was never committed: the drain will not find it
      expect(await outbox()).toEqual([]);
      expect((await pool.query('SELECT status FROM reservations WHERE id = $1', [a.id])).rows[0].status).toBe('requested');
    });

    it('writes the env of the process: VERCEL_ENV, development off Vercel', async () => {
      expect(outboxEnv({})).toBe('development');
      expect(outboxEnv({ VERCEL_ENV: 'development' })).toBe('development');
      expect(outboxEnv({ VERCEL_ENV: 'preview' })).toBe('preview');
      expect(outboxEnv({ VERCEL_ENV: 'production' })).toBe('production');
      vi.stubEnv('VERCEL_ENV', 'preview');
      try {
        await guestBooking({ email: '' });
        const effects = outboxEffects();
        await createStaffReservation(pool, LAN, staffBooking({ time: '20:30', phone: '0905 111 225', phoneE164: '+84905111225' }), { now: NOW, effects });
      } finally {
        vi.unstubAllEnvs();
      }
      expect((await pool.query(`SELECT DISTINCT env FROM email_outbox`)).rows).toEqual([{ env: 'preview' }]);
    });
  });
});
