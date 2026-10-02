import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EmailEvent } from '@/lib/email/events';
import { loadBookingEmailData } from '@/lib/server/email/booking/load';
import { renderOutboxEmail } from '@/lib/server/email/booking/render';
import { TEST_DATABASE_URL } from '../helpers/db';

/*
 * Phase 5's booking emails against the database: rendering a booking's email
 * from its row as the drain does (the language rule R10, content_strings
 * overrides, no internal notes, the destination's phone, Reply-To). Never a
 * real SMTP server.
 */

let pool: Pool;

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
  });
  afterAll(async () => {
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
      const vi = await seedReservation({ locale: 'vi', status: 'confirmed' });
      const off = await render('guest.confirmed', vi, 'vi');
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
      const staff = await render('staff.new', vi, 'vi');
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
});
