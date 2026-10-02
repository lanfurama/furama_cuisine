import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { formatIsoDayVi } from '../lib/admin/format';
import { expectHydrated, watchCsp } from './csp';
import { emailsTo } from './email-log';
import { seedReservation, venueDay } from './reservation-fixtures';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * Phase 5 email screens (spec §7.2): the email log with "Gửi lại", the
 * booking's own emails, the overview's counts, and the Admin's "Thông báo
 * email" (recipients, the restaurants left to the shared inbox, "Gửi email
 * thử"). The server runs EMAIL_DELIVERY=log, so a "sent" email is a line in
 * EMAIL_LOG_FILE. Data: Hải Vân Lounge +40 (no other spec books that far) and
 * yesterday (a sitting that has passed), recipients on Hura Izakaya under a
 * fresh address, removed afterwards. No
 * spec running beside this one may add an 'all' or a 'destination'
 * recipient: booking-email expects the general inbox.
 */

test.beforeAll(() => seedStaff());
test.use({ reducedMotion: 'reduce' });

const main = (page: Page) => page.getByRole('main');
const nav = (page: Page) => page.getByRole('navigation', { name: 'Điều hướng quản trị' });
const unique = () => randomBytes(3).toString('hex');

const TIMEOUT = 'provider_error: SMTP ETIMEDOUT at CONN: Greeting never received';

/** A guest.confirmed email for a fresh confirmed booking (19:00), as the sender left it: failed after 7 sends. */
async function failedEmail(
  to: string,
  { date = venueDay(40), lastError = TIMEOUT }: { date?: string; lastError?: string } = {},
): Promise<{ reservationId: string; reference: string; outboxId: string }> {
  const r = await seedReservation({ restaurant: 'hai-van-lounge', date, status: 'confirmed', meal: 'Dinner' });
  await one(`UPDATE reservations SET email = $2 WHERE id = $1`, [r.id, to]);
  const row = await one<{ id: string }>(
    `INSERT INTO email_outbox (env, event, audience, reservation_id, to_email, locale, status, attempts, last_error)
     VALUES ('development', 'guest.confirmed', 'guest', $1, $2, 'en', 'failed', 7, $3)
     RETURNING id::text`,
    [r.id, to, lastError],
  );
  return { reservationId: r.id, reference: r.reference, outboxId: row!.id };
}

test('an Editor finds a failed email on the overview and the log, masked, and sends it again', async ({ page }) => {
  const guest = `khach.${unique()}@guest.test`;
  const { reservationId, reference, outboxId } = await failedEmail(guest);
  const violations = await watchCsp(page);
  await signInAs(page, STAFF.editor);
  await expect(main(page).getByTestId('failed-emails')).toContainText('email lỗi');
  // Not the Admin's: no "chưa có người nhận" section.
  await expect(main(page).getByTestId('uncovered-restaurants')).toHaveCount(0);

  await page.goto('/admin/reservations/emails?tab=failed');
  await expectHydrated(page);
  await expect(main(page).getByTestId('delivery-mode')).toContainText('chỉ ghi log');
  await expect(main(page).getByText('sau 1 phút, 5 phút, 15 phút, 1 giờ, 6 giờ, 12 giờ')).toBeVisible();
  await expect(main(page).getByText('Tổng quan chỉ đếm email của những lượt đặt bàn chưa tới giờ.')).toBeVisible();
  const row = main(page).getByRole('row').filter({ hasText: reference });
  await expect(row).toContainText('Khách: đã xác nhận');
  await expect(row).toContainText(`k•••@guest.test`);
  await expect(row).not.toContainText(guest);
  await expect(row).toContainText('7 lần gửi');
  await expect(row).toContainText(`Giờ hẹn: ${formatIsoDayVi(venueDay(40))} 19:00`);
  // What to do, in Vietnamese, then the stored error itself.
  await expect(row).toContainText('Không kết nối được máy chủ SMTP: kiểm tra SMTP_HOST, SMTP_PORT và SMTP_SECURE.');
  await expect(row).toContainText('SMTP ETIMEDOUT');

  await row.getByRole('button', { name: `Gửi lại Khách: đã xác nhận ${reference}` }).click();
  await expect(row.getByRole('status')).toContainText('Đã đưa vào hàng gửi');
  // The send runs in after(): the row turns sent once the response is out.
  await expect.poll(async () => (await one<{ status: string }>(`SELECT status FROM email_outbox WHERE id = $1`, [outboxId]))?.status, { timeout: 10_000 }).toBe('sent');
  const [email] = emailsTo(guest);
  expect(email.subject).toBe(`Your table is confirmed (${reference})`);
  expect(email.text).toContain('Your table at Hải Vân Lounge is confirmed.');
  expect(await one(`SELECT actor_id, before, after FROM audit_log WHERE entity_type = 'email_outbox' AND entity_id = $1`, [outboxId])).toEqual({
    actor_id: STAFF.editor.id,
    before: { status: 'failed', attempts: 7 },
    after: { status: 'queued' },
  });

  // The booking shows its email, in full, sent on the first fresh attempt.
  await page.goto(`/admin/reservations/${reservationId}`);
  const emails = main(page).getByRole('table', { name: 'Email của đặt bàn' });
  await expect(emails.getByRole('row').filter({ hasText: guest })).toContainText('Đã gửi');
  await expect(emails.getByRole('row').filter({ hasText: guest })).toContainText('1 lần gửi');
  expect(violations).toEqual([]);
});

test('a failed email whose sitting has passed shows the sitting and no "Gửi lại"; the overview counts emails still retrying', async ({ page }) => {
  const guest = `khach.${unique()}@guest.test`;
  const refused = "rejected: SMTP EENVELOPE at RCPT TO: Can't send mail - all recipients were rejected: 550 5.1.1 <redacted>: Recipient address rejected: User unknown";
  const { reservationId, reference } = await failedEmail(guest, { date: venueDay(-1), lastError: refused });
  await signInAs(page, STAFF.editor);
  // Overview numbers are shared with the specs running beside this one: only the links are checked.
  await expect(main(page).getByTestId('failed-emails')).toHaveAttribute('href', '/admin/reservations/emails?tab=failed');
  const retrying = main(page).getByTestId('retrying-emails');
  await expect(retrying).toContainText('email đang thử lại');
  await expect(retrying).toHaveAttribute('href', '/admin/reservations/emails?tab=queued');

  await page.goto('/admin/reservations/emails?tab=failed');
  await expectHydrated(page);
  const row = main(page).getByRole('row').filter({ hasText: reference });
  await expect(row).toContainText(`Giờ hẹn: ${formatIsoDayVi(venueDay(-1))} 19:00`);
  await expect(row).toContainText('Máy chủ SMTP từ chối địa chỉ người nhận: kiểm tra lại địa chỉ (gửi lại sẽ không giúp).');
  await expect(row.getByRole('button', { name: /^Gửi lại/ })).toHaveCount(0);

  // The booking's own table: the same hint, the whole stored error, and no "Gửi lại" either.
  await page.goto(`/admin/reservations/${reservationId}`);
  const email = main(page).getByRole('table', { name: 'Email của đặt bàn' }).getByRole('row').filter({ hasText: guest });
  await expect(email).toContainText('Máy chủ SMTP từ chối địa chỉ người nhận');
  await expect(email).toContainText('Recipient address rejected: User unknown');
  await expect(email.getByRole('button', { name: /^Gửi lại/ })).toHaveCount(0);
});

test('"Gửi lại" is refused for an email that was sent meanwhile', async ({ page }) => {
  const guest = `khach.${unique()}@guest.test`;
  const { reference, outboxId } = await failedEmail(guest);
  await signInAs(page, STAFF.editor);
  await page.goto('/admin/reservations/emails?tab=failed');
  await expectHydrated(page);
  const row = main(page).getByRole('row').filter({ hasText: reference });
  // Meanwhile the cron sent it.
  await one(`UPDATE email_outbox SET status = 'sent', sent_at = now() WHERE id = $1`, [outboxId]);
  await row.getByRole('button', { name: /^Gửi lại/ }).click();
  await expect(row.getByRole('alert')).toContainText('không gửi lại được');
});

test('the Admin’s overview names the restaurants whose new-booking email goes to the shared inbox', async ({ page }) => {
  await signInAs(page, STAFF.admin);
  const uncovered = main(page).getByTestId('uncovered-restaurants');
  await expect(uncovered).toContainText('Café Indochine');
  await expect(uncovered).toContainText('hộp thư chung');
  await main(page).getByRole('link', { name: 'Mở Thông báo email để thêm người nhận' }).click();
  await expect(page.getByRole('heading', { name: 'Thông báo email', level: 1 })).toBeVisible();
});

test('an Editor has no notification settings: no menu item, and the 403 view', async ({ page }) => {
  await signInAs(page, STAFF.editor);
  await expect(nav(page).getByRole('link', { name: 'Thông báo email' })).toHaveCount(0);
  const res = await page.goto('/admin/settings/notifications');
  expect(await res?.text()).not.toContain('Hộp thư chung');
  await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible();
});

test('the Admin adds a recipient, sees which restaurants still go to the shared inbox, and sends a test email', async ({ page }) => {
  const address = `bep.${unique()}@furama.test`;
  const violations = await watchCsp(page);
  try {
    await signInAs(page, STAFF.admin);
    await nav(page).getByRole('link', { name: 'Thông báo email' }).click();
    await expect(page.getByRole('heading', { name: 'Thông báo email', level: 1 })).toBeVisible();
    await expectHydrated(page);
    await expect(main(page).getByTestId('delivery-mode')).toContainText('chỉ ghi log');

    const add = page.getByRole('form', { name: 'Thêm người nhận' });
    await add.getByLabel('Email người nhận', { exact: true }).fill(address);
    await add.getByLabel('Nhận thông báo của', { exact: true }).selectOption('restaurant');
    await add.getByLabel('Nhà hàng', { exact: true }).selectOption('hura-izakaya');
    await add.getByRole('button', { name: 'Thêm người nhận' }).click();
    await expect(add.getByRole('status')).toHaveText('Đã thêm người nhận.');
    await expect(main(page).getByRole('region', { name: `${address} · Nhà hàng: Hura Izakaya` })).toBeVisible();
    expect(await one(`SELECT scope, restaurant_id, locale, events, active FROM notification_recipients WHERE email = $1`, [address])).toEqual({
      scope: 'restaurant',
      restaurant_id: 'hura-izakaya',
      locale: 'vi',
      events: ['staff.new'],
      active: true,
    });
    // The same address on the same restaurant again: refused at the field.
    await add.getByLabel('Email người nhận', { exact: true }).fill(address.toUpperCase());
    await add.getByLabel('Nhận thông báo của', { exact: true }).selectOption('restaurant');
    await add.getByLabel('Nhà hàng', { exact: true }).selectOption('hura-izakaya');
    await add.getByRole('button', { name: 'Thêm người nhận' }).click();
    await expect(add.getByText('Địa chỉ này đã nhận thông báo cho cùng phạm vi.')).toBeVisible();

    // Hura Izakaya now has someone; it leaves the list of restaurants that fall back to the shared inbox.
    const uncovered = main(page).getByRole('list', { name: 'Nhà hàng chưa có người nhận' });
    await expect(uncovered.getByText('Café Indochine', { exact: true })).toBeVisible();
    await expect(uncovered.getByText('Hura Izakaya', { exact: true })).toHaveCount(0);

    const trial = page.getByRole('form', { name: 'Gửi email thử' });
    const to = `thu.${unique()}@furama.test`;
    await trial.getByLabel('Gửi tới', { exact: true }).fill(to);
    await trial.getByRole('button', { name: 'Gửi email thử' }).click();
    await expect(trial.getByRole('status')).toContainText('chỉ ghi log');
    await expect.poll(() => emailsTo(to).length).toBe(1);
    const [email] = emailsTo(to);
    expect(email.subject).toMatch(/^\[Email thử\] Đặt bàn mới FC-0000TEST: Tàya House, .* 19:00, 4 khách$/);
    expect(email.text).toContain('Nguyễn Thị Mẫu');
    expect(violations).toEqual([]);
  } finally {
    await one(`DELETE FROM notification_recipients WHERE lower(email) = lower($1)`, [address]);
  }
});
