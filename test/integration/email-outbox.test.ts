import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebReservation } from '@/lib/server/booking/create';
import { parseReservationInput } from '@/lib/server/booking/input';
import { createStaffReservation, transitionReservation, type ReservationActor, type StaffBookingInput } from '@/lib/server/booking/reservations';
import { LEASE_SECONDS, RETRY_DELAYS_MINUTES, drainOutbox, type DrainOptions } from '@/lib/server/email/drain';
import { outboxEnv } from '@/lib/server/email/env';
import { outboxEffects } from '@/lib/server/email/outbox';
import { TEST_DATABASE_URL } from '../helpers/db';
import { startSmtpSink, type SinkOptions, type SmtpSink } from '../helpers/smtp-sink';

/*
 * Spec §10.3–10.4 in the database, over SMTP to a local sink: which change
 * queues which email to whom (rows written in the change's own transaction),
 * and the drain (lease, Message-ID, skip, retries, failure, concurrency, a
 * crash between the send and its bookkeeping).
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
const full = async (id: string) =>
  (
    await pool.query(
      `SELECT *, extract(epoch FROM next_attempt_at - now()) / 60 AS wait_min, locked_until > now() AS leased FROM email_outbox WHERE id = $1`,
      [id],
    )
  ).rows[0];
const recipient = (over: Record<string, unknown>) => {
  const r = { scope: 'all', email: 'all@furama.test', ...over };
  const cols = Object.keys(r);
  return pool.query(`INSERT INTO notification_recipients (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(r));
};

/** Pretends the clock moved on: every waiting row is due now. */
const makeDue = () => pool.query(`UPDATE email_outbox SET next_attempt_at = now() WHERE status = 'queued'`);

let sinks: SmtpSink[] = [];
async function sink(options: SinkOptions = {}) {
  const s = await startSmtpSink(options);
  sinks.push(s);
  return s;
}
const drainTo = (s: SmtpSink, options: DrainOptions = {}) =>
  drainOutbox({ pool, env: s.env(), mailer: { transportOverrides: s.clientOverrides }, ...options });

describe.skipIf(!TEST_DATABASE_URL)('email outbox (database + local SMTP sink)', () => {
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
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(sinks.map((s) => s.close()));
    sinks = [];
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
  describe('the drain', () => {
    it('sends each row over SMTP once, records the reply, and puts the Message-ID it fixed on the wire', async () => {
      const s = await sink();
      await recipient({ scope: 'all', email: 'gm@furama.test' });
      const booking = await guestBooking();
      const report = await drainTo(s, { ids: booking.outboxIds });
      expect(report).toEqual({ claimed: 2, sent: 2, skipped: 0, retried: 0, failed: 0, lost: 0 });

      const rows = await pool.query(`SELECT id::text, status, attempts, message_id, provider_id, sent_at IS NOT NULL AS sent, locked_until FROM email_outbox ORDER BY id`);
      for (const row of rows.rows) {
        expect(row).toMatchObject({ status: 'sent', attempts: 1, sent: true, locked_until: null });
        expect(row.message_id).toMatch(new RegExp(`^<outbox-${row.id}\\.[0-9a-f]{12}@mail\\.furama\\.test>$`));
        expect(row.provider_id).toMatch(/^250 Ok: queued as SINK\d$/);
      }
      expect(s.received.map((m) => [m.to[0], m.messageId])).toEqual(rows.rows.map((r, i) => [['gm@furama.test', 'guest@example.com'][i], r.message_id]));
      expect(s.received.map((m) => m.subject)).toEqual([
        `Đặt bàn mới ${booking.reference}: Tàya House, Th 2, 5 thg 10, 2026 19:00, 2 khách`,
        `We have received your table request (${booking.reference})`,
      ]);
      // Staff reply to the guest; the guest replies to the shared inbox (R11).
      expect(s.received.map((m) => m.replyTo)).toEqual(['guest@example.com', 'fb@furamavietnam.com']);
      // Nothing left: a second drain claims nothing.
      expect(await drainTo(s)).toMatchObject({ claimed: 0 });
      expect(s.received).toHaveLength(2);
    });

    it('drains only its own env: a Preview never sends production rows, and the reverse', async () => {
      const s = await sink();
      await guestBooking();
      await pool.query(`UPDATE email_outbox SET env = 'production'`);
      expect(await drainTo(s, { env: s.env({ VERCEL_ENV: 'preview' }) })).toMatchObject({ claimed: 0 });
      expect(await drainTo(s)).toMatchObject({ claimed: 0 }); // development
      expect(await drainTo(s, { env: s.env({ VERCEL_ENV: 'production' }) })).toMatchObject({ claimed: 2, sent: 2 });
    });

    it('retries after 1 m, 5 m, 15 m, 1 h, 6 h and 12 h with the same Message-ID, then marks it failed after the 7th attempt', async () => {
      const s = await sink({ failData: () => 451 });
      await guestBooking({ email: '' }); // one row: staff.new to the general email
      const [{ id }] = await outbox();
      const waits: number[] = [];
      for (let attempt = 1; attempt <= 7; attempt++) {
        const report = await drainTo(s);
        expect(report.claimed).toBe(1);
        const row = await full(id);
        expect(row.attempts).toBe(attempt);
        if (attempt < 7) {
          expect(row).toMatchObject({ status: 'queued', locked_until: null, last_error: 'provider_error: SMTP EMESSAGE at DATA: Message failed: 451 Temporary failure, try again' });
          waits.push(Math.round(Number(row.wait_min)));
          // Not due yet: another drain leaves it alone.
          expect(await drainTo(s)).toMatchObject({ claimed: 0 });
          await makeDue();
        } else {
          expect(row).toMatchObject({ status: 'failed', locked_until: null, sent_at: null });
        }
      }
      expect(waits).toEqual([...RETRY_DELAYS_MINUTES]);
      expect(s.seen).toHaveLength(7);
      expect(new Set(s.seen.map((m) => m.messageId)).size).toBe(1);
      // Every attempt within a day: 1+5+15+60+360+720 = 1161 minutes, about 19.4 h.
      expect(RETRY_DELAYS_MINUTES.reduce((a, b) => a + b, 0)).toBe(1161);
      // Failed is final: no drain picks it up again ("Gửi lại" comes with the email log).
      expect(await drainTo(s)).toMatchObject({ claimed: 0 });
    });

    it('a 5xx after the message (a provider quota, say) is retried, not final', async () => {
      const s = await sink({ failData: (i) => (i === 0 ? 554 : null) });
      await guestBooking({ email: '' });
      const [{ id }] = await outbox();
      expect(await drainTo(s)).toMatchObject({ claimed: 1, retried: 1, failed: 0 });
      expect((await full(id)).last_error).toBe('provider_error: SMTP EMESSAGE at DATA: Message failed: 554 Message rejected');
      await makeDue();
      expect(await drainTo(s)).toMatchObject({ claimed: 1, sent: 1 });
    });

    it('a recipient refused for good (550) fails at once, without retries', async () => {
      const s = await sink({ refuseRecipient: (a) => (a === 'gone@example.com' ? 550 : null) });
      await guestBooking({ email: 'gone@example.com' });
      const report = await drainTo(s);
      expect(report).toMatchObject({ claimed: 2, sent: 1, failed: 1, retried: 0 });
      const failed = (await outbox(`status = 'failed'`))[0];
      expect(await full(failed.id)).toMatchObject({ attempts: 1, last_error: expect.stringMatching(/^rejected: SMTP EENVELOPE at RCPT TO: .*550 <redacted>/) });
      expect((await full(failed.id)).last_error).not.toContain('gone@example.com');
    });

    it('skips an email that no longer matches the booking: a confirmation cancelled before it went, an ack after the confirm', async () => {
      const s = await sink();
      const a = await guestBooking();
      const version = async () => (await pool.query('SELECT version FROM reservations WHERE id = $1', [a.id])).rows[0].version;
      await transitionReservation(pool, LAN, { id: a.id, version: await version(), to: 'confirmed', reason: null, notifyGuest: false }, { now: NOW, effects: outboxEffects('development') });
      await transitionReservation(pool, LAN, { id: a.id, version: await version(), to: 'cancelled', reason: 'Khách đổi ý', notifyGuest: true }, { now: NOW, effects: outboxEffects('development') });
      const report = await drainTo(s);
      expect(report).toMatchObject({ claimed: 4, sent: 1, skipped: 3 });
      expect((await pool.query(`SELECT event, status, last_error FROM email_outbox ORDER BY id`)).rows).toEqual([
        // The staff were the ones who cancelled it: a "new booking" note about it is moot.
        { event: 'staff.new', status: 'skipped', last_error: 'skipped: the booking is now cancelled' },
        { event: 'guest.ack', status: 'skipped', last_error: 'skipped: the booking is now cancelled' },
        { event: 'guest.confirmed', status: 'skipped', last_error: 'skipped: the booking is now cancelled' },
        { event: 'guest.cancelled', status: 'sent', last_error: null },
      ]);
      expect(s.received.map((m) => m.subject)).toEqual([`Your reservation has been cancelled (${a.reference})`]);
    });

    it('skips a guest email whose address changed since it was queued, and one whose booking was anonymised', async () => {
      const s = await sink();
      const a = await guestBooking();
      const b = await guestBooking({ time: '19:30' });
      await pool.query(`UPDATE reservations SET email = 'fixed@example.com' WHERE id = $1`, [a.id]);
      await pool.query(`UPDATE reservations SET anonymized_at = now() WHERE id = $1`, [b.id]);
      expect(await drainTo(s)).toMatchObject({ claimed: 4, sent: 1, skipped: 3 });
      expect((await pool.query(`SELECT reservation_id::text AS r, event, status, last_error FROM email_outbox ORDER BY id`)).rows).toEqual([
        { r: a.id, event: 'staff.new', status: 'sent', last_error: null },
        { r: a.id, event: 'guest.ack', status: 'skipped', last_error: 'skipped: the guest email changed' },
        { r: b.id, event: 'staff.new', status: 'skipped', last_error: 'skipped: the booking was anonymised' },
        { r: b.id, event: 'guest.ack', status: 'skipped', last_error: 'skipped: the booking was anonymised' },
      ]);
    });

    it('two drains at once never send the same row twice', async () => {
      const s = await sink({ holdDataMs: 30 });
      for (let i = 0; i < 6; i++) await guestBooking({ time: ['18:00', '18:30', '19:00', '19:30', '20:00', '20:30'][i] });
      const rows = await outbox();
      expect(rows).toHaveLength(12);
      const other = new Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
      try {
        const [one, two] = await Promise.all([drainTo(s), drainTo(s, { pool: other })]);
        expect(one.sent + two.sent).toBe(12);
        expect(one.claimed).toBeGreaterThan(0);
        expect(two.claimed).toBeGreaterThan(0);
      } finally {
        await other.end();
      }
      expect(s.received).toHaveLength(12);
      expect(new Set(s.received.map((m) => m.messageId)).size).toBe(12);
      expect((await outbox(`status <> 'sent' OR attempts <> 1`)).length).toBe(0);
    });

    it('a row locked elsewhere does not stall the drain: it sends the others now (SKIP LOCKED)', async () => {
      const s = await sink();
      await guestBooking({ email: '' });
      await guestBooking({ email: '', time: '19:30' });
      const [first, second] = await outbox();
      const holder = await pool.connect();
      try {
        await holder.query('BEGIN');
        await holder.query('SELECT 1 FROM email_outbox WHERE id = $1 FOR UPDATE', [first.id]);
        const report = await Promise.race([drainTo(s), new Promise((done) => setTimeout(() => done('stalled'), 2_000))]);
        expect(report).toMatchObject({ claimed: 1, sent: 1 });
        expect(await full(second.id)).toMatchObject({ status: 'sent' });
      } finally {
        await holder.query('ROLLBACK');
        holder.release();
      }
      expect(await drainTo(s)).toMatchObject({ claimed: 1, sent: 1 });
      expect(s.received).toHaveLength(2);
    });

    it('a crash between the send and "sent": the lease holds it, then the next drain sends it again with the same Message-ID', async () => {
      const s = await sink();
      await guestBooking({ email: '' });
      const [{ id }] = await outbox();
      // A pool whose UPDATE … 'sent' never returns: the function died right after the server said 250.
      const dying = {
        query: (text: string, values?: unknown[]) => (text.includes("status = 'sent'") ? new Promise(() => {}) : pool.query(text, values)),
      } as unknown as Pool;
      void drainTo(s, { pool: dying });
      await vi.waitFor(() => expect(s.received).toHaveLength(1));
      expect(await full(id)).toMatchObject({ status: 'sending', attempts: 1, leased: true });

      // Within the lease nobody touches it: no second copy.
      expect(await drainTo(s)).toMatchObject({ claimed: 0 });
      // The lease (LEASE_SECONDS) runs out: the next cron sends it again, recognisably the same message.
      expect(LEASE_SECONDS).toBe(120);
      await pool.query(`UPDATE email_outbox SET locked_until = now() - interval '1 second' WHERE id = $1`, [id]);
      expect(await drainTo(s)).toMatchObject({ claimed: 1, sent: 1 });
      expect(await full(id)).toMatchObject({ status: 'sent', attempts: 2 });
      expect(s.received).toHaveLength(2);
      expect(s.received[1].messageId).toBe(s.received[0].messageId);
    });

    it('the "sent" mark failing after a send is not a send failure: tried once more, and never scheduled for a retry (C14)', async () => {
      const s = await sink();
      await guestBooking({ email: '' });
      await guestBooking({ email: '', time: '19:30' });
      const [first, second] = await outbox();
      // The first 'sent' mark of each row hits a database error; the second one works for the first row only.
      let failures = 0;
      const flaky = {
        query: (text: string, values?: unknown[]) => {
          if (text.includes("status = 'sent'") && ((values?.[0] === first.id && failures++ === 0) || values?.[0] === second.id)) {
            return Promise.reject(Object.assign(new Error('connection terminated'), { code: '57P01' }));
          }
          return pool.query(text, values);
        },
      } as unknown as Pool;
      const errors = vi.mocked(console.error);
      expect(await drainTo(s, { pool: flaky })).toEqual({ claimed: 2, sent: 1, skipped: 0, retried: 0, failed: 0, lost: 1 });
      expect(s.received).toHaveLength(2);
      expect(await full(first.id)).toMatchObject({ status: 'sent', attempts: 1, last_error: null });
      // Still under its lease, not queued for a retry: a later drain re-sends it only once the lease is over.
      expect(await full(second.id)).toMatchObject({ status: 'sending', attempts: 1, leased: true, last_error: null });
      expect(errors).toHaveBeenCalledWith(`[outbox] sent but not recorded id=${second.id} event=staff.new attempt=1 code=mark_failed`, { pg: '57P01' });
    });

    it('a drain whose lease ran out mid-send cannot overwrite the newer claim (fenced by attempts)', async () => {
      // Both sends wait 600 ms for the server; the first then fails with 451, the second is accepted.
      const s = await sink({ holdDataMs: 600, failData: (i) => (i === 0 ? 451 : null) });
      await guestBooking({ email: '' });
      const [{ id }] = await outbox();
      const slow = drainTo(s);
      await vi.waitFor(() => expect(s.attempts).toBe(1));
      // While the first drain still waits for the server, its lease is taken as expired and another drain claims the row.
      await pool.query(`UPDATE email_outbox SET locked_until = now() - interval '1 second' WHERE id = $1`, [id]);
      const fast = drainTo(s);
      await vi.waitFor(() => expect(s.attempts).toBe(2));
      // The first drain's failure comes back while the second send is in flight: it must not requeue the row.
      expect(await slow).toMatchObject({ claimed: 1, retried: 0, lost: 1 });
      expect(await fast).toMatchObject({ claimed: 1, sent: 1, lost: 0 });
      expect(await full(id)).toMatchObject({ status: 'sent', attempts: 2, last_error: null });
      expect(s.received).toHaveLength(1);
      expect(new Set(s.seen.map((m) => m.messageId)).size).toBe(1);
    });

    it('a claim that died on its 7th attempt is marked failed once its lease ends', async () => {
      const s = await sink();
      await guestBooking({ email: '' });
      const [{ id }] = await outbox();
      await pool.query(`UPDATE email_outbox SET status = 'sending', attempts = 7, locked_until = now() - interval '1 second' WHERE id = $1`, [id]);
      expect(await drainTo(s)).toMatchObject({ claimed: 0, failed: 1 });
      expect(await full(id)).toMatchObject({ status: 'failed', last_error: 'lease_expired: the last attempt never reported back' });
      expect(s.attempts).toBe(0);
    });

    it('log mode marks rows sent without SMTP; log mode on a Vercel deployment is a failure that retries', async () => {
      await guestBooking({ email: '' });
      const [{ id }] = await outbox();
      const logged: unknown[] = [];
      const logSink = (e: unknown) => void logged.push(e);
      expect(await drainOutbox({ pool, env: { VERCEL_ENV: 'preview', EMAIL_DELIVERY: 'log' }, mailer: { logSink } })).toMatchObject({ claimed: 0 });
      await pool.query(`UPDATE email_outbox SET env = 'preview'`);
      expect(await drainOutbox({ pool, env: { VERCEL_ENV: 'preview', EMAIL_DELIVERY: 'log' }, mailer: { logSink } })).toMatchObject({ retried: 1 });
      expect((await full(id)).last_error).toMatch(/^not_delivered: /);
      await pool.query(`UPDATE email_outbox SET env = 'development', next_attempt_at = now()`);
      expect(await drainOutbox({ pool, env: {}, mailer: { logSink } })).toMatchObject({ sent: 1 });
      expect(await full(id)).toMatchObject({ status: 'sent', provider_id: 'log', attempts: 2 });
      expect(logged).toHaveLength(2);
    });

    it('an SMTP server that is down: the booking stands, the row waits for the next attempt', async () => {
      const s = await sink();
      await s.close();
      sinks = [];
      const booking = await guestBooking({ email: '' });
      const report = await drainOutbox({ pool, env: s.env(), mailer: { transportOverrides: s.clientOverrides } });
      expect(report).toMatchObject({ claimed: 1, retried: 1 });
      const lastError = (await full(booking.outboxIds[0])).last_error;
      expect(lastError).toMatch(/^provider_error: SMTP ESOCKET at CONN: connect ECONNREFUSED/);
      // Where the SMTP server is stays out of the error, as addresses do: Editors read it in the email log.
      expect(lastError).not.toContain('127.0.0.1');
      expect(lastError).toContain('<smtp-host>');
      expect((await pool.query('SELECT count(*)::int AS n FROM reservations')).rows[0].n).toBe(1);
    });

    it('logs ids, events, codes and attempts, never an address', async () => {
      const s = await sink({ refuseRecipient: (a) => (a === 'gone@example.com' ? 550 : null) });
      await guestBooking({ email: 'gone@example.com' });
      await drainTo(s);
      const lines = [vi.mocked(console.info), vi.mocked(console.warn), vi.mocked(console.error)].flatMap((m) => m.mock.calls.map((c) => c.join(' ')));
      expect(lines.filter((l) => l.startsWith('[outbox]'))).toHaveLength(2);
      expect(lines.filter((l) => l.startsWith('[outbox]') && l.includes('@'))).toEqual([]);
    });
  });
});
