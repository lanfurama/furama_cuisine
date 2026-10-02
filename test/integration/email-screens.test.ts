import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailEvent } from '@/lib/email/events';
import { loadBookingEmailData } from '@/lib/server/email/booking/load';
import { renderOutboxEmail } from '@/lib/server/email/booking/render';
import { queueStaffNew } from '@/lib/server/email/outbox';
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
import { createEmailSender } from '@/lib/server/email/send';
import { sendTestEmail } from '@/lib/server/email/test-email';
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

async function seedReservation(over: { status?: string; email?: string | null; locale?: string; restaurant?: string; statusReason?: string | null } = {}) {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, phone_e164, email, status, status_reason, meal, source, locale, note)
     VALUES ('FC-' || upper(substr(md5(random()::text), 1, 8)), $1, '2026-10-05', '19:00', 4, 'Nguyễn Thị Ánh', '0905 123 456',
             '+849052' || lpad((floor(random() * 1e5))::int::text, 5, '0'), $2, $3, $4, 'Dinner', 'web', $5, 'Bàn gần cửa sổ.')
     RETURNING id::text`,
    [over.restaurant ?? 'taya-house', over.email === undefined ? 'anh.nguyen@guest.vn' : over.email, over.status ?? 'requested', over.statusReason ?? null, over.locale ?? 'en'],
  );
  return rows[0].id;
}

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
      const viBooking = await seedReservation({ locale: 'vi', status: 'confirmed' });
      const off = await render('guest.confirmed', viBooking, 'vi');
      expect(off).toMatchObject({ locale: 'vi', subject: expect.stringMatching(/^Đặt bàn của bạn đã được xác nhận \(FC-/) });
      expect(off.html).toContain('lang="vi"');
      expect(off.text).toContain('Thứ Hai, 5 tháng 10, 2026');
      // A language with no copy of its own, switched off: the default language, not English copy with Korean dates.
      await pool.query(`INSERT INTO locales (code, bcp47, native_name, short_label, script, sort_order) VALUES ('ko', 'ko', '한국어', 'KO', 'hangul', 90)`);
      const ko = await seedReservation({ locale: 'ko', status: 'confirmed' });
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
});
