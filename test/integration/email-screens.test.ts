import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailEvent } from '@/lib/email/events';
import { loadBookingEmailData } from '@/lib/server/email/booking/load';
import { renderOutboxEmail } from '@/lib/server/email/booking/render';
import { MAX_ATTEMPTS } from '@/lib/server/email/drain';
import { queueStaffNew } from '@/lib/server/email/outbox';
import { EMAIL_LOG_PAGE_SIZE, emailOverview, listEmailLog, listReservationEmails, requeueEmail } from '@/lib/server/email/outbox-log';
import {
  createRecipient,
  deleteRecipient,
  getSharedInbox,
  listRecipients,
  restaurantsWithoutRecipient,
  saveSharedInbox,
  updateRecipient,
  type RecipientInput,
} from '@/lib/server/email/recipients';
import { REGISTRY } from '@/lib/i18n/registry';
import { createEmailSender } from '@/lib/server/email/send';
import { sendTestEmail } from '@/lib/server/email/test-email';
import { addDays, venueNow } from '@/lib/venue-time';
import { TEST_DATABASE_URL } from '../helpers/db';
import { startSmtpSink, type SmtpSink } from '../helpers/smtp-sink';

/*
 * Phase 5's booking emails and email screens against the database: rendering
 * a booking's email from its row as the drain does (the language rule R10,
 * content_strings overrides, no internal notes, the destination's phone,
 * Reply-To); who hears about a booking; the recipients and shared-inbox saves
 * with their audit rows; "Gửi email thử" over a local SMTP sink. Never a real
 * SMTP server.
 */

let pool: Pool;
let sink: SmtpSink;
const ADMIN = { id: 'admin-1', email: 'owner@furama.test', name: 'Chủ quán' };
const ORIGIN = 'https://admin.furama.test';
/** Da Nang's date `n` days from today: the overview and the log compare sittings with the database's clock. */
const venueDay = (n: number) => addDays(venueNow().date, n);

const recipient = (over: Partial<RecipientInput> = {}): RecipientInput => ({
  scope: 'all',
  destinationId: null,
  restaurantId: null,
  email: 'lan@furama.test',
  events: ['staff.new'],
  locale: 'vi',
  active: true,
  ...over,
});

/** The staff.new rows a web booking at `restaurant` would queue now, as [address, language, fallback]. */
async function wouldQueue(restaurant: string): Promise<[string, string, boolean][]> {
  const id = await seedReservation({ restaurant });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const event = await client.query<{ id: string }>(
      `INSERT INTO reservation_events (reservation_id, actor_kind, type, to_status) VALUES ($1, 'guest', 'created', 'requested') RETURNING id::text`,
      [id],
    );
    await queueStaffNew(client, { reservationId: id, eventId: event.rows[0].id, env: 'development' });
    const { rows } = await client.query<{ to_email: string; locale: string; fallback: boolean }>(
      `SELECT to_email, locale, fallback FROM email_outbox WHERE reservation_id = $1 ORDER BY lower(to_email)`,
      [id],
    );
    return rows.map((r) => [r.to_email, r.locale, r.fallback]);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

/** A booking at 19:00, 30 days ahead unless `date` says otherwise (a sitting still ahead on any real clock). */
async function seedReservation(
  over: { status?: string; email?: string | null; locale?: string; restaurant?: string; statusReason?: string | null; date?: string } = {},
) {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, phone_e164, email, status, status_reason, meal, source, locale, note)
     VALUES ('FC-' || upper(substr(md5(random()::text), 1, 8)), $1, $6::date, '19:00', 4, 'Nguyễn Thị Ánh', '0905 123 456',
             '+849052' || lpad((floor(random() * 1e5))::int::text, 5, '0'), $2, $3, $4, 'Dinner', 'web', $5, 'Bàn gần cửa sổ.')
     RETURNING id::text`,
    [
      over.restaurant ?? 'taya-house',
      over.email === undefined ? 'anh.nguyen@guest.vn' : over.email,
      over.status ?? 'requested',
      over.statusReason ?? null,
      over.locale ?? 'en',
      over.date ?? venueDay(30),
    ],
  );
  return rows[0].id;
}

/** An outbox row about booking `reservationId`, as a sender would have left it. */
async function queue(
  reservationId: string,
  over: {
    event?: string;
    to?: string;
    env?: string;
    status?: string;
    attempts?: number;
    locale?: string;
    lockedFor?: string;
    createdAt?: string;
    lastError?: string;
  } = {},
) {
  const event = over.event ?? 'guest.confirmed';
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO email_outbox (env, event, audience, reservation_id, to_email, locale, status, attempts, locked_until, sent_at, created_at, last_error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + $9::interval, CASE WHEN $7 = 'sent' THEN now() END, coalesce($10::timestamptz, now()), $11)
     RETURNING id::text`,
    [
      over.env ?? 'development',
      event,
      event.startsWith('staff.') ? 'staff' : 'guest',
      reservationId,
      over.to ?? 'anh.nguyen@guest.vn',
      over.locale ?? 'en',
      over.status ?? 'queued',
      over.attempts ?? 0,
      over.lockedFor ?? null,
      over.createdAt ?? null,
      over.lastError ?? null,
    ],
  );
  return rows[0].id;
}

const outbox = async (id: string) =>
  (
    await pool.query<{ status: string; attempts: number; locked_until: Date | null; next_in_minutes: number }>(
      `SELECT status, attempts, locked_until, round(extract(epoch FROM next_attempt_at - now()) / 60)::int AS next_in_minutes FROM email_outbox WHERE id = $1`,
      [id],
    )
  ).rows[0];

/** What the drain renders for an outbox row of `event` in `locale` about booking `id`. */
async function render(event: EmailEvent, id: string, locale: string) {
  const data = await loadBookingEmailData(pool, id);
  if (!data) throw new Error(`no booking ${id}`);
  return renderOutboxEmail(pool, { event, locale }, data);
}

describe.skipIf(!TEST_DATABASE_URL)('email screens and templates (database)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    sink = await startSmtpSink({ login: { user: 'mailer', pass: 'sink-password' } });
  });
  afterAll(async () => {
    await sink.close();
    await pool.query(`UPDATE site_settings SET email = 'fb@furamavietnam.com'`);
    await pool.query(`DELETE FROM content_strings WHERE key LIKE 'email.%'`);
    await pool.query(`DELETE FROM locales WHERE code = 'ko'`);
    await pool.query(`UPDATE locales SET is_enabled = (code = 'en')`);
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE reservations, reservation_events, reservation_notes, email_outbox, notification_recipients, audit_log CASCADE');
    await pool.query(`DELETE FROM content_strings WHERE key LIKE 'email.%'`);
    await pool.query(`DELETE FROM locales WHERE code = 'ko'`);
    await pool.query(`UPDATE locales SET is_enabled = (code = 'en')`);
    await pool.query(`UPDATE site_settings SET email = 'fb@furamavietnam.com'`);
  });

  describe('rendering from the reservation row', () => {
    it('a guest email speaks the booking’s language when it is on, or when the registry has its copy (vi); else the default (R10)', async () => {
      // vi is off on the site (migration 004), yet the registry has every email key in Vietnamese: a phone booking in vi reads Vietnamese.
      // Rendering reads no clock, so a literal date can pin the formatted day.
      const viBooking = await seedReservation({ locale: 'vi', status: 'confirmed', date: '2026-10-05' });
      const off = await render('guest.confirmed', viBooking, 'vi');
      expect(off).toMatchObject({ locale: 'vi', subject: expect.stringMatching(/^Đặt bàn của bạn đã được xác nhận \(FC-/) });
      expect(off.html).toContain('lang="vi"');
      expect(off.text).toContain('Thứ Hai, 5 tháng 10, 2026');
      // A language with no copy of its own, switched off: the default language, not English copy with Korean dates.
      await pool.query(`INSERT INTO locales (code, bcp47, native_name, short_label, script, sort_order) VALUES ('ko', 'ko', '한국어', 'KO', 'hangul', 90)`);
      const ko = await seedReservation({ locale: 'ko', status: 'confirmed', date: '2026-10-05' });
      const fallback = await render('guest.confirmed', ko, 'ko');
      expect(fallback).toMatchObject({ locale: 'en', subject: expect.stringMatching(/^Your table is confirmed \(FC-/) });
      expect(fallback.text).toContain('Monday, October 5, 2026');
      // Switched on, it is the guest's language: English copy per key, its own date format (Known risk 19).
      await pool.query(`UPDATE locales SET is_enabled = true WHERE code = 'ko'`);
      const on = await render('guest.confirmed', ko, 'ko');
      expect(on.locale).toBe('ko');
      expect(on.html).toContain('lang="ko"');
      // Staff keep the recipient's language, on the site or not.
      const staff = await render('staff.new', viBooking, 'vi');
      expect(staff).toMatchObject({ locale: 'vi', subject: expect.stringMatching(/^Đặt bàn mới FC-/) });
    });

    it('content_strings override the registry: the default language always, another one once reviewed', async () => {
      const id = await seedReservation({ status: 'confirmed' });
      await pool.query(
        `INSERT INTO content_strings (key, locale, value, status, origin) VALUES
           ('email.guest.confirmed.heading', 'en', 'See you soon', 'reviewed', 'human'),
           ('email.staff.new.heading', 'vi', 'Đơn mới (máy dịch)', 'machine', 'ai')`,
      );
      expect((await render('guest.confirmed', id, 'en')).text).toContain('See you soon');
      // An unreviewed machine row for vi (serve_machine off) does not reach the email; the registry's Vietnamese does.
      const staff = await render('staff.new', id, 'vi');
      expect(staff.text).toContain('Có đặt bàn online mới');
      expect(staff.text).not.toContain('máy dịch');
    });

    it('a reviewed vi row beats the registry’s Vietnamese for staff (phase-5 ledger T5.5)', async () => {
      const id = await seedReservation({ status: 'requested' });
      await pool.query(
        `INSERT INTO content_strings (key, locale, value, status, origin) VALUES ('email.staff.new.heading', 'vi', 'Có khách đặt bàn mới', 'reviewed', 'human')`,
      );
      const staff = await render('staff.new', id, 'vi');
      expect(staff.text).toContain('Có khách đặt bàn mới');
      expect(staff.text).not.toContain(REGISTRY['email.staff.new.heading'].vi);
    });

    it('staff.new says what the booking was when it was made, not what it is now: a retry after a hand confirmation is still a request (T5.1)', async () => {
      const id = await seedReservation({ status: 'confirmed' });
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO reservation_events (reservation_id, actor_kind, type, to_status) VALUES ($1, 'guest', 'created', 'requested') RETURNING id::text`,
        [id],
      );
      const data = (await loadBookingEmailData(pool, id))!;
      const retried = await renderOutboxEmail(pool, { event: 'staff.new', locale: 'vi', reservation_event_id: rows[0].id }, data);
      expect(retried.text).toContain(REGISTRY['email.staff.new.intro_requested'].vi);
      expect(retried.text).not.toContain(REGISTRY['email.staff.new.intro_confirmed'].vi);
      // Without the event (an older row), today's status decides, as before.
      expect((await render('staff.new', id, 'vi')).text).toContain(REGISTRY['email.staff.new.intro_confirmed'].vi);
    });

    it('never carries internal notes; the guest’s own request reaches staff only', async () => {
      const id = await seedReservation({ status: 'cancelled', statusReason: 'Bếp đóng cửa sửa chữa.' });
      await pool.query(`INSERT INTO reservation_notes (reservation_id, author_id, author_label, body) VALUES ($1, 'admin-1', 'Lan', 'Khách VIP, nợ tiền lần trước')`, [id]);
      for (const event of ['staff.new', 'guest.cancelled'] as const) {
        const email = await render(event, id, 'en');
        expect(email.html).not.toContain('Khách VIP');
        expect(email.text).not.toContain('Khách VIP');
      }
      const guest = await render('guest.cancelled', id, 'en');
      expect(guest.text).toContain('Bếp đóng cửa sửa chữa.');
      expect(guest.text).not.toContain('Bàn gần cửa sổ.');
      expect(guest.text).not.toContain('0905 123 456');
      expect(guest.html).not.toContain('/admin/');
      const staff = await render('staff.new', id, 'en');
      expect(staff.text).toContain('Bàn gần cửa sổ.');
      expect(staff.text).toContain(`http://localhost:3000/admin/reservations/${id}`);
    });

    it('the destination’s phone, and replies to the guest (staff) or the shared inbox (guest) (R11)', async () => {
      const resort = await seedReservation({ status: 'confirmed', restaurant: 'taya-house' });
      const house = await seedReservation({ status: 'confirmed', restaurant: 'pho-cuon' });
      expect((await render('guest.confirmed', resort, 'en')).text).toContain('+84 236 651 9999');
      await pool.query(`UPDATE site_settings SET email = 'contact@furama.test'`);
      const g = await render('guest.confirmed', house, 'en');
      expect(g.text).toContain('0859 555 759');
      expect(g.replyTo).toBe('contact@furama.test');
      expect((await render('staff.new', house, 'vi')).replyTo).toBe('anh.nguyen@guest.vn');
      const noEmail = await seedReservation({ email: null });
      expect((await render('staff.new', noEmail, 'vi')).replyTo).toBeUndefined();
    });
  });
  describe('who gets staff.new (spec §10.4)', () => {
    it('merges all, the destination and the restaurant, one row per address, the most specific language', async () => {
      await createRecipient(pool, ADMIN, recipient({ email: 'gm@furama.test' }));
      await createRecipient(pool, ADMIN, recipient({ scope: 'destination', destinationId: 'resort', email: 'fb.resort@furama.test' }));
      await createRecipient(pool, ADMIN, recipient({ scope: 'restaurant', restaurantId: 'taya-house', email: 'taya@furama.test', locale: 'en' }));
      // The same address again, on the restaurant, in English: one email, in English.
      await createRecipient(pool, ADMIN, recipient({ scope: 'restaurant', restaurantId: 'taya-house', email: 'GM@furama.test', locale: 'en' }));
      await createRecipient(pool, ADMIN, recipient({ scope: 'restaurant', restaurantId: 'pho-cuon', email: 'pho@furama.test' }));
      await createRecipient(pool, ADMIN, recipient({ scope: 'restaurant', restaurantId: 'taya-house', email: 'off@furama.test', active: false }));
      expect(await wouldQueue('taya-house')).toEqual([
        ['fb.resort@furama.test', 'vi', false],
        ['GM@furama.test', 'en', false],
        ['taya@furama.test', 'en', false],
      ]);
      expect(await wouldQueue('pho-cuon')).toEqual([
        ['gm@furama.test', 'vi', false],
        ['pho@furama.test', 'vi', false],
      ]);
    });

    it('nobody matches: the shared inbox, in Vietnamese, as a fallback; the restaurants in that case are the ones listed (R21)', async () => {
      await createRecipient(pool, ADMIN, recipient({ scope: 'restaurant', restaurantId: 'taya-house', email: 'taya@furama.test' }));
      expect(await wouldQueue('pho-cuon')).toEqual([['fb@furamavietnam.com', 'vi', true]]);
      const missing = (await restaurantsWithoutRecipient(pool)).map((r) => r.id);
      expect(missing).not.toContain('taya-house');
      expect(missing).toContain('pho-cuon');
      // The list and the queue agree for every restaurant.
      for (const { id } of await pool.query<{ id: string }>(`SELECT id FROM restaurants WHERE booking_enabled`).then((r) => r.rows)) {
        expect((await wouldQueue(id))[0][2], id).toBe(missing.includes(id));
      }
      await pool.query(`UPDATE restaurants SET booking_enabled = false WHERE id = 'pho-cuon'`);
      try {
        expect((await restaurantsWithoutRecipient(pool)).map((r) => r.id)).not.toContain('pho-cuon');
      } finally {
        await pool.query(`UPDATE restaurants SET booking_enabled = true WHERE id = 'pho-cuon'`);
      }
      await createRecipient(pool, ADMIN, recipient({ scope: 'all', email: 'gm@furama.test' }));
      expect(await restaurantsWithoutRecipient(pool)).toEqual([]);
    });
  });

  describe('saving recipients and the shared inbox', () => {
    it('create, update and delete each write one audit row; a save on a stale token is a conflict', async () => {
      const created = await createRecipient(pool, ADMIN, recipient());
      expect(created.ok).toBe(true);
      const [row] = await listRecipients(pool);
      expect(row).toMatchObject({ scope: 'all', email: 'lan@furama.test', events: ['staff.new'], locale: 'vi', active: true, restaurantName: null });
      const updated = await updateRecipient(pool, ADMIN, { ...recipient({ locale: 'en', active: false }), id: row.id, token: row.token });
      expect(updated).toEqual({ ok: true, data: null });
      const stale = await updateRecipient(pool, ADMIN, { ...recipient(), id: row.id, token: row.token });
      expect(stale).toMatchObject({ ok: false, code: 'conflict', params: { by: 'người khác' } });
      const [after] = await listRecipients(pool);
      expect(after).toMatchObject({ locale: 'en', active: false });
      expect(await deleteRecipient(pool, ADMIN, { id: row.id, token: row.token })).toMatchObject({ ok: false, code: 'conflict' });
      expect(await deleteRecipient(pool, ADMIN, { id: row.id, token: after.token })).toEqual({ ok: true, data: null });
      expect(await deleteRecipient(pool, ADMIN, { id: row.id, token: after.token })).toEqual({ ok: false, code: 'not_found' });
      const { rows } = await pool.query<{ action: string; entity_type: string; before: unknown; after: unknown }>(
        `SELECT action, entity_type, before, after FROM audit_log ORDER BY id`,
      );
      expect(rows.map((r) => [r.action, r.entity_type])).toEqual([
        ['create', 'notification_recipient'],
        ['update', 'notification_recipient'],
        ['delete', 'notification_recipient'],
      ]);
      expect(rows[1]).toMatchObject({ before: { locale: 'vi', active: true }, after: { locale: 'en', active: false } });
    });

    it('the same address twice on one target is refused, whatever its case; another target is another row', async () => {
      await createRecipient(pool, ADMIN, recipient({ email: 'lan@furama.test' }));
      expect(await createRecipient(pool, ADMIN, recipient({ email: 'LAN@furama.test' }))).toEqual({ ok: false, code: 'duplicate' });
      expect((await createRecipient(pool, ADMIN, recipient({ scope: 'restaurant', restaurantId: 'taya-house', email: 'lan@furama.test' }))).ok).toBe(true);
      const [all, taya] = await listRecipients(pool);
      expect(await updateRecipient(pool, ADMIN, { ...recipient({ email: 'Lan@Furama.test' }), id: taya.id, token: taya.token })).toEqual({ ok: false, code: 'duplicate' });
      expect(all.restaurantName).toBeNull();
      expect(taya.restaurantName).toBe('Tàya House');
    });

    it('the shared inbox saves with its token and audits the change', async () => {
      const before = await getSharedInbox(pool);
      expect(before.email).toBe('fb@furamavietnam.com');
      expect(await saveSharedInbox(pool, ADMIN, { email: 'datban@furama.test', token: before.token })).toEqual({ ok: true, data: null });
      expect(await saveSharedInbox(pool, ADMIN, { email: 'x@furama.test', token: before.token })).toMatchObject({ code: 'conflict' });
      expect((await getSharedInbox(pool)).email).toBe('datban@furama.test');
      const { rows } = await pool.query(`SELECT action, entity_type, before, after FROM audit_log`);
      expect(rows).toEqual([{ action: 'settings', entity_type: 'site_settings', before: { email: 'fb@furamavietnam.com' }, after: { email: 'datban@furama.test' } }]);
    });
  });

  describe('"Gửi email thử" (R9)', () => {
    it('sends the sample booking’s email in the language asked for, marked as a test, through the same gate, and stores nothing', async () => {
      const before = sink.received.length;
      const send = createEmailSender({ env: sink.env(), transportOverrides: sink.clientOverrides });
      const result = await sendTestEmail(pool, { to: 'it@furama.test', event: 'staff.new', locale: 'vi' }, { adminOrigin: ORIGIN, send });
      expect(result).toEqual({ ok: true, data: { mode: 'live', to: 'it@furama.test' } });
      const [got] = sink.received.slice(before);
      expect(got.to).toEqual(['it@furama.test']);
      expect(got.subject).toMatch(/^\[Email thử\] Đặt bàn mới FC-0000TEST: Tàya House, .+ 19:00, 4 khách$/);
      expect(got.replyTo).toBe('khach.mau@example.com');
      // The body is the sample booking's: its reference and phone, never a real guest's.
      expect(got.raw.split(/\r?\n\r?\n/).slice(1).join('\n')).toContain('0905 000 000');
      // No booking was read or written, and no outbox row.
      expect((await pool.query('SELECT (SELECT count(*)::int FROM email_outbox) + (SELECT count(*)::int FROM reservations) AS n')).rows[0].n).toBe(0);
    });

    it('redirect mode says where it really went; a refused login answers email_failed with an address-free error, logging only the code', async () => {
      const redirect = createEmailSender({ env: sink.env({ EMAIL_DELIVERY: 'redirect', EMAIL_REDIRECT_TO: 'qa@furama.test' }), transportOverrides: sink.clientOverrides });
      expect(
        await sendTestEmail(pool, { to: 'it@furama.test', event: 'guest.confirmed', locale: 'en' }, { adminOrigin: ORIGIN, send: redirect, env: { EMAIL_REDIRECT_TO: 'qa@furama.test' } }),
      ).toEqual({ ok: true, data: { mode: 'redirect', to: 'qa@furama.test' } });
      expect(sink.received.at(-1)?.subject).toMatch(/^\[it@furama\.test\] \[Email thử\] Your table is confirmed \(FC-0000TEST\)$/);
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const badAuth = createEmailSender({ env: sink.env({ SMTP_PASSWORD: 'wrong' }), transportOverrides: sink.clientOverrides });
      const failed = await sendTestEmail(pool, { to: 'it@furama.test', event: 'guest.ack', locale: 'en' }, { adminOrigin: ORIGIN, send: badAuth });
      expect(failed).toMatchObject({ ok: false, code: 'email_failed', params: { error: expect.stringMatching(/^provider_error: SMTP EAUTH at AUTH PLAIN: Invalid login: 535/) } });
      expect(JSON.stringify(failed)).not.toContain('@');
      expect(errors.mock.calls).toEqual([['[email] test send failed', { code: 'provider_error' }]]);
      errors.mockRestore();
    });
  });

  describe('the email log', () => {
    it('lists this env only, newest first, by status, 50 a page with a keyset cursor', async () => {
      const id = await seedReservation();
      const mine: string[] = [];
      for (let i = 0; i < EMAIL_LOG_PAGE_SIZE + 2; i += 1) {
        mine.push(await queue(id, { createdAt: `2026-10-01T00:${String(i).padStart(2, '0')}:00Z`, status: i % 2 ? 'failed' : 'sent' }));
      }
      await queue(id, { env: 'production', status: 'failed' });
      const held = await queue(id, { status: 'sending', lockedFor: '1 minute' });
      const first = await listEmailLog(pool, { env: 'development', tab: 'all' });
      expect(first.rows).toHaveLength(EMAIL_LOG_PAGE_SIZE);
      expect(first.rows[0].id).toBe(held);
      const second = await listEmailLog(pool, { env: 'development', tab: 'all', after: first.next });
      expect(second.rows.map((r) => r.id)).toEqual([mine[2], mine[1], mine[0]]);
      expect(second.next).toBeNull();
      // Every second seeded row failed (26 of 52); the production one is another env's.
      const failedTab = (await listEmailLog(pool, { env: 'development', tab: 'failed' })).rows;
      expect(failedTab).toHaveLength(mine.filter((_, i) => i % 2).length);
      expect(failedTab.every((r) => r.status === 'failed')).toBe(true);
      // "Đang chờ" shows the rows a sender holds too.
      expect((await listEmailLog(pool, { env: 'development', tab: 'queued' })).rows.map((r) => [r.id, r.status])).toEqual([[held, 'sending']]);
      // A cursor that is not one is ignored, not an error.
      expect((await listEmailLog(pool, { env: 'development', tab: 'all', after: "1'; DROP TABLE x" })).rows).toHaveLength(EMAIL_LOG_PAGE_SIZE);
      expect((await listReservationEmails(pool, id, 'production')).map((r) => r.status)).toEqual(['failed']);
      expect(first.rows[1]).toMatchObject({ reservationId: id, restaurantName: 'Tàya House', event: 'guest.confirmed', audience: 'guest', toEmail: 'anh.nguyen@guest.vn' });
    });

    it('the overview counts this env’s failed emails and names the restaurants that fall back to the shared inbox (R21)', async () => {
      const id = await seedReservation();
      await queue(id, { status: 'failed' });
      await queue(id, { status: 'failed', env: 'production' });
      await queue(id, { status: 'sent' });
      const overview = await emailOverview(pool, 'development');
      expect(overview.failed).toBe(1);
      expect(overview.unrouted).toEqual(await restaurantsWithoutRecipient(pool));
      expect(overview.unrouted.map((r) => r.id)).toContain('taya-house');
      expect((await emailOverview(pool, 'production')).failed).toBe(1);
      await createRecipient(pool, ADMIN, recipient({ scope: 'all', email: 'gm@furama.test' }));
      expect(await emailOverview(pool, 'development')).toEqual({ failed: 1, retrying: 0, unrouted: [] });
    });

    it('the overview counts only what staff can act on: failed and retrying emails of sittings still ahead; the log shows each sitting (F7)', async () => {
      const ERROR = 'provider_error: SMTP ETIMEDOUT at CONN: Greeting never received';
      const yesterday = await seedReservation({ status: 'confirmed', date: venueDay(-1) });
      const ahead = await seedReservation({ status: 'confirmed', date: venueDay(30) });
      await queue(yesterday, { status: 'failed', attempts: MAX_ATTEMPTS, lastError: ERROR });
      await queue(yesterday, { attempts: 2, lastError: ERROR }); // retrying, but about a meal already eaten
      await queue(ahead, { status: 'failed', attempts: MAX_ATTEMPTS, lastError: ERROR });
      await queue(ahead, { attempts: 1, lastError: ERROR }); // retrying
      await queue(ahead); // queued, never tried
      await queue(ahead, { status: 'failed', attempts: MAX_ATTEMPTS, lastError: ERROR, env: 'production' });
      expect(await emailOverview(pool, 'development')).toMatchObject({ failed: 1, retrying: 1 });
      expect(await emailOverview(pool, 'production')).toMatchObject({ failed: 1, retrying: 0 });

      // The "Lỗi" tab still lists every failed row; each row carries its sitting, and whether it has passed.
      const failedTab = (await listEmailLog(pool, { env: 'development', tab: 'failed' })).rows;
      expect(failedTab.map((r) => [r.reservationId, r.sittingDate, r.sittingTime, r.sittingPassed])).toEqual([
        [ahead, venueDay(30), '19:00', false],
        [yesterday, venueDay(-1), '19:00', true],
      ]);
      expect((await listReservationEmails(pool, yesterday, 'development')).map((r) => r.sittingPassed)).toEqual([true, true]);
    });
  });

  describe('"Gửi lại" (C9, R2)', () => {
    it('puts a failed email back in the queue with fresh attempts, due now; a waiting one is just due now; each writes one audit row', async () => {
      const id = await seedReservation({ status: 'confirmed' });
      const failed = await queue(id, { status: 'failed', attempts: MAX_ATTEMPTS });
      expect(await requeueEmail(pool, ADMIN, { id: failed, env: 'development' })).toEqual({ ok: true, data: { id: failed, reservationId: id } });
      expect(await outbox(failed)).toMatchObject({ status: 'queued', attempts: 0, locked_until: null, next_in_minutes: 0 });
      const waiting = await queue(id, { attempts: 2 });
      await pool.query(`UPDATE email_outbox SET next_attempt_at = now() + interval '15 minutes' WHERE id = $1`, [waiting]);
      expect((await requeueEmail(pool, ADMIN, { id: waiting, env: 'development' })).ok).toBe(true);
      expect(await outbox(waiting)).toMatchObject({ status: 'queued', attempts: 2, next_in_minutes: 0 });
      // The booking's timeline is untouched (R2); audit_log has the who and the what, no address.
      expect((await pool.query('SELECT count(*)::int AS n FROM reservation_events')).rows[0].n).toBe(0);
      const audit = (await pool.query(`SELECT actor_id, action, entity_type, entity_id, before, after FROM audit_log ORDER BY id`)).rows;
      expect(audit).toEqual([
        { actor_id: 'admin-1', action: 'update', entity_type: 'email_outbox', entity_id: failed, before: { status: 'failed', attempts: 7 }, after: { status: 'queued' } },
        { actor_id: 'admin-1', action: 'update', entity_type: 'email_outbox', entity_id: waiting, before: { status: 'queued', attempts: 2 }, after: { status: 'queued' } },
      ]);
      expect(JSON.stringify(audit)).not.toContain('@guest.vn');
    });

    it('refuses a sent or skipped email, one a sender holds, and another env’s row', async () => {
      const id = await seedReservation({ status: 'confirmed' });
      const sent = await queue(id, { status: 'sent' });
      const skipped = await queue(id, { status: 'skipped' });
      const held = await queue(id, { status: 'sending', lockedFor: '1 minute' });
      const prod = await queue(id, { status: 'failed', env: 'production' });
      for (const target of [sent, skipped, held]) expect(await requeueEmail(pool, ADMIN, { id: target, env: 'development' })).toEqual({ ok: false, code: 'not_allowed' });
      expect(await requeueEmail(pool, ADMIN, { id: prod, env: 'development' })).toEqual({ ok: false, code: 'not_found' });
      expect(await outbox(held)).toMatchObject({ status: 'sending', locked_until: expect.any(Date) });
      expect((await pool.query('SELECT count(*)::int AS n FROM audit_log')).rows[0].n).toBe(0);
    });

    it('decides on the row as it is once locked: a claim that lands first wins, and the requeue is refused', async () => {
      const id = await seedReservation({ status: 'confirmed' });
      const row = await queue(id, { status: 'failed', attempts: MAX_ATTEMPTS });
      const sender = await pool.connect();
      try {
        // A sender's claim, not yet committed, holds the row.
        await sender.query('BEGIN');
        await sender.query(`UPDATE email_outbox SET status = 'sending', attempts = 1, locked_until = now() + interval '2 minutes' WHERE id = $1`, [row]);
        const requeue = requeueEmail(pool, ADMIN, { id: row, env: 'development' });
        await new Promise((done) => setTimeout(done, 200));
        await sender.query('COMMIT');
        expect(await requeue).toEqual({ ok: false, code: 'not_allowed' });
      } finally {
        sender.release();
      }
      expect(await outbox(row)).toMatchObject({ status: 'sending', attempts: 1 });
    });
  });
});
