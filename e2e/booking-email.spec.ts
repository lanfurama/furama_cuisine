import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { HOME_PATH } from './paths';
import { seedReservation } from './reservation-fixtures';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * Phase 5 in a real `next start` (EMAIL_DELIVERY=log, so every email lands in
 * EMAIL_LOG_FILE): a new booking emails the staff (the general inbox when no
 * recipient is listed) and the guest, sent by after() once the action has
 * answered; confirming emails the guest; the cron endpoint wants its secret.
 * The guest books Café Indochine on its last open day, which no other spec
 * books. No spec running beside this one may add an 'all' or 'destination'
 * recipient: it would take the staff email away from the general inbox.
 */

type Logged = { to: string; subject: string; text: string };
function logged(): Logged[] {
  const file = process.env.EMAIL_LOG_FILE;
  if (!file) throw new Error('Set EMAIL_LOG_FILE (the server writes emails there) to run the booking email specs.');
  try {
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Logged);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
/** [to, subject] of every logged email about one booking. */
const about = (reference: string) => logged().filter((e) => e.subject.includes(reference)).map((e) => [e.to, e.subject]);

test.use({ reducedMotion: 'reduce' });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
});

async function bookCafeIndochine(page: Page, guest: string): Promise<string> {
  await page.goto(HOME_PATH);
  await page.locator('.rcard:visible', { hasText: 'Café Indochine' }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.daystrip .day')).toHaveCount(14);
  // The last day of the window is never past its sittings.
  await drawer.locator('.daystrip .day[data-state="open"]').last().click();
  await drawer.locator('.slot:not([disabled])').first().click();
  await drawer.getByLabel('Full name *', { exact: true }).fill('Nguyễn Minh Anh');
  const digits = String(Date.now()).slice(-6);
  await drawer.getByLabel('Phone *', { exact: true }).fill(`0906 ${digits.slice(0, 3)} ${digits.slice(3)}`);
  await drawer.getByLabel('Email', { exact: true }).fill(guest);
  await drawer.getByRole('checkbox', { name: 'I agree to Furama Cuisine using my details as described in the privacy policy.' }).check();
  await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();
  await expect(drawer.locator('.drawer-ref')).toHaveText(/^FC-[0-9A-HJKMNP-TV-Z]{8}$/);
  return (await drawer.locator('.drawer-ref').textContent()) ?? '';
}

test('a guest booking emails the staff (the general inbox: nobody is listed) and the guest, after the response', async ({ page }) => {
  const guest = `guest-${Date.now()}@example.com`;
  const reference = await bookCafeIndochine(page, guest);
  await expect.poll(() => about(reference)).toEqual([
    ['fb@furamavietnam.com', expect.stringMatching(new RegExp(`^Đặt bàn mới ${reference}: Café Indochine, .+ \\d{2}:\\d{2}, 2 khách$`))],
    [guest, `We have received your table request (${reference})`],
  ]);
  const ack = logged().find((e) => e.to === guest && e.subject.includes(reference));
  expect(ack?.text).toContain('Your table request at Café Indochine has been received. Our team will contact you shortly to confirm.');
  const rows = await one<{ statuses: string[]; events: string[]; fallback: boolean[] }>(
    `SELECT array_agg(o.status ORDER BY o.id) AS statuses, array_agg(o.event ORDER BY o.id) AS events, array_agg(o.fallback ORDER BY o.id) AS fallback
       FROM email_outbox o JOIN reservations r ON r.id = o.reservation_id WHERE r.reference = $1`,
    [reference],
  );
  expect(rows).toEqual({ statuses: ['sent', 'sent'], events: ['staff.new', 'guest.ack'], fallback: [true, false] });
});

test('confirming in the admin emails the guest', async ({ page }) => {
  await seedStaff();
  const r = await seedReservation();
  const guest = `confirm-${r.id}@example.com`;
  await one(`UPDATE reservations SET email = $2 WHERE id = $1`, [r.id, guest]);
  await signInAs(page, STAFF.editor);
  await page.goto(`/admin/reservations/${r.id}`);
  await page.getByRole('main').getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(page.getByRole('main').getByRole('status')).toHaveText('Đã cập nhật trạng thái.');
  await expect.poll(() => about(r.reference)).toEqual([[guest, `Your table is confirmed (${r.reference})`]]);
  expect(await one(`SELECT status, attempts FROM email_outbox WHERE reservation_id = $1`, [r.id])).toEqual({ status: 'sent', attempts: 1 });
});

test('the cron endpoint answers 401 without its secret, and drains with it', async ({ request }) => {
  expect((await request.get('/api/cron/outbox')).status()).toBe(401);
  expect((await request.get('/api/cron/outbox', { headers: { authorization: 'Bearer not-the-secret-at-all' } })).status()).toBe(401);
  const res = await request.get('/api/cron/outbox', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toBe('no-store');
  expect(await res.json()).toMatchObject({ claimed: expect.any(Number), failed: 0 });
});
