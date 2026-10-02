import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { HOME_PATH } from './paths';
import { seedReservation } from './reservation-fixtures';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * Phase 5's acceptance (spec §14.1 row 5) in a real `next start`
 * (EMAIL_DELIVERY=log, so every email lands in EMAIL_LOG_FILE):
 *   A1 a new booking emails the staff, sent by after() once the action has answered;
 *   A2 confirming emails the guest;
 *   A3 a failed email is retried (the cron sends it again; "Gửi lại" is in admin-emails);
 *   A4 with no recipient it goes to the general email, and the overview names the restaurant;
 *   spec §13: the cron endpoint answers 401 without its secret.
 * A5 (bots are blocked) is guest-guard.spec.ts, the opt-in botid.spec.ts and
 * the integration tests. The guest books Café Indochine on its last open day,
 * which no other spec books. No spec running beside this one may add an 'all'
 * or 'destination' recipient: it would take the staff email away from the
 * general inbox.
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
/** [to, subject] of every logged email about one booking, by recipient: after() sends them in no promised order. */
const about = (reference: string) =>
  logged()
    .filter((e) => e.subject.includes(reference))
    .map((e) => [e.to, e.subject])
    .sort(([a], [b]) => a.localeCompare(b));

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

test('A1, A4. a guest booking emails the staff (the general inbox: nobody is listed) and the guest, after the response', async ({ page }) => {
  const guest = `guest-${Date.now()}@example.com`;
  const reference = await bookCafeIndochine(page, guest);
  // Sorted by recipient: the shared inbox (fb@…) before the guest (guest-…).
  await expect.poll(() => about(reference)).toEqual([
    ['fb@furamavietnam.com', expect.stringMatching(new RegExp(`^Đặt bàn mới ${reference}: Café Indochine, .+ \\d{2}:\\d{2}, 2 khách$`))],
    [guest, `We have received your table request (${reference})`],
  ]);
  const ack = logged().find((e) => e.to === guest && e.subject.includes(reference));
  expect(ack?.text).toContain('Your table request at Café Indochine has been received. Our team will contact you shortly to confirm.');
  // The log line is written during the send; the row is marked sent just after it: poll, never read once.
  await expect
    .poll(() =>
      one<{ statuses: string[]; events: string[]; fallback: boolean[] }>(
        `SELECT array_agg(o.status ORDER BY o.id) AS statuses, array_agg(o.event ORDER BY o.id) AS events, array_agg(o.fallback ORDER BY o.id) AS fallback
           FROM email_outbox o JOIN reservations r ON r.id = o.reservation_id WHERE r.reference = $1`,
        [reference],
      ),
    )
    .toEqual({ statuses: ['sent', 'sent'], events: ['staff.new', 'guest.ack'], fallback: [true, false] });

  // A4: the Admin's overview names the restaurant whose new-booking email went to the shared inbox.
  await seedStaff();
  await signInAs(page, STAFF.admin);
  await expect(page.getByRole('main').getByTestId('uncovered-restaurants')).toContainText('Café Indochine');
});

test('A2. confirming in the admin emails the guest', async ({ page }) => {
  await seedStaff();
  const r = await seedReservation();
  const guest = `confirm-${r.id}@example.com`;
  await one(`UPDATE reservations SET email = $2 WHERE id = $1`, [r.id, guest]);
  await signInAs(page, STAFF.editor);
  await page.goto(`/admin/reservations/${r.id}`);
  await page.getByRole('main').getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(page.getByRole('main').getByRole('status')).toHaveText('Đã chuyển sang “Đã xác nhận”. Email báo khách đang được gửi.');
  await expect.poll(() => about(r.reference)).toEqual([[guest, `Your table is confirmed (${r.reference})`]]);
  await expect.poll(() => one(`SELECT status, attempts FROM email_outbox WHERE reservation_id = $1`, [r.id])).toEqual({ status: 'sent', attempts: 1 });
});

test('A3. a failed email is retried: the next cron run sends a row whose first attempt failed', async ({ request }) => {
  const r = await seedReservation({ status: 'confirmed' });
  const guest = `retry-${r.id}@example.com`;
  await one(`UPDATE reservations SET email = $2 WHERE id = $1`, [r.id, guest]);
  // As the sender leaves a row after a provider error on its first attempt: queued again, and due.
  const row = await one<{ id: string }>(
    `INSERT INTO email_outbox (env, event, audience, reservation_id, to_email, locale, status, attempts, next_attempt_at, last_error)
     VALUES ('development', 'guest.confirmed', 'guest', $1, $2, 'en', 'queued', 1, now() - interval '1 minute',
             'provider_error: SMTP ETIMEDOUT at CONN: Greeting never received')
     RETURNING id::text`,
    [r.id, guest],
  );
  const res = await request.get('/api/cron/outbox', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  expect(res.status()).toBe(200);
  await expect
    .poll(() => one(`SELECT status, attempts, last_error FROM email_outbox WHERE id = $1`, [row!.id]))
    .toEqual({ status: 'sent', attempts: 2, last_error: null });
  expect(about(r.reference)).toEqual([[guest, `Your table is confirmed (${r.reference})`]]);
});

test('spec §13: the cron endpoint answers 401 without its secret, and drains with it', async ({ request }) => {
  expect((await request.get('/api/cron/outbox')).status()).toBe(401);
  expect((await request.get('/api/cron/outbox', { headers: { authorization: 'Bearer not-the-secret-at-all' } })).status()).toBe(401);
  const res = await request.get('/api/cron/outbox', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toBe('no-store');
  expect(await res.json()).toMatchObject({ claimed: expect.any(Number), failed: 0 });
});
