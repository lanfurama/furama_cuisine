import type { Browser, Page } from '@playwright/test';
import { formatDay } from '../lib/venue-time';
import { expectHydrated } from './csp';
import { HOME_PATH } from './paths';
import { reservationRow, seedReservation, venueDay } from './reservation-fixtures';
import { STAFF, db, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * Spec §14.1, phase 4 ("Đặt bàn v2"), each acceptance criterion end to end
 * through the screens a guest and the staff use:
 *   A1 concurrent bookings never exceed capacity;
 *   A2 closed days are greyed out for guests;
 *   A3 confirm, cancel and no-show work correctly;
 *   A4 an Editor changes the dinner hours and capacity, and the guest sees the new slots at once;
 *   A5 max_party = 8 makes the form block 9 guests;
 *   A6 the bookings a change leaves out are listed (and never cancelled on their own).
 * Yum Food Village (MM Supercenter, Lunch and Dinner, 60 covers a slot) at
 * dates no other spec books there. The tests of this file run in order, in
 * one worker, and each puts back the rules it changed; they share Yum's
 * rules, so this file is never run with --repeat-each (repeats would run in
 * parallel workers).
 */

test.beforeAll(() => seedStaff());
test.use({ reducedMotion: 'reduce' }); // no reveal animation on the booking bar

const YUM = 'yum-food-village';
const SEED_DINNER = `UPDATE service_periods SET last_seating = '21:00', covers_per_slot = 60 WHERE restaurant_id = '${YUM}' AND meal = 'Dinner'`;
const CLEAR_AUDIT = `DELETE FROM audit_log WHERE entity_id = '${YUM}'`;

/** A guest in a browser of their own (no staff cookie), past the intro. */
async function guestPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  return context.newPage();
}

/** The guest opens Yum Food Village's drawer from its card (it has no page of its own) and picks the day `days` out. */
async function openYum(page: Page, days: number) {
  await page.goto(HOME_PATH);
  await page.locator('.rcard:visible', { hasText: 'Yum Food Village' }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.daystrip .day')).toHaveCount(14);
  const day = drawer.locator('.daystrip .day').nth(days);
  return { drawer, day };
}

const heldCovers = async (date: string, time: string) =>
  (
    await one<{ covers: number }>(
      `SELECT coalesce(sum(guests), 0)::int AS covers FROM reservations
        WHERE restaurant_id = $1 AND reserved_on = $2 AND reserved_at = $3 AND status IN ('requested', 'confirmed', 'seated')`,
      [YUM, date, time],
    )
  )!.covers;

test('A1. concurrent bookings never exceed capacity: eight replays of a guest’s request for the last four covers book two', async ({ browser }) => {
  const date = venueDay(12);
  // A slot filled by an earlier run on this database would leave nothing to race for.
  await one(`DELETE FROM reservations WHERE restaurant_id = $1 AND reserved_on = $2 AND reserved_at = '19:00'`, [YUM, date]);
  // 54 of the 60 covers at 19:00 are held: six left.
  await seedReservation({ restaurant: YUM, date, time: '19:00', guests: 50, status: 'confirmed' });
  await seedReservation({ restaurant: YUM, date, time: '19:00', guests: 4 });

  const guest = await guestPage(browser);
  const { drawer, day } = await openYum(guest, 12);
  await day.click();
  await drawer.getByRole('button', { name: '19:00 — 6 covers left' }).click();
  await drawer.getByLabel('Full name *', { exact: true }).fill('Khách Đua');
  const digits = String(Date.now()).slice(-5);
  const phone = `0907 ${digits.slice(0, 3)} ${digits.slice(3)}0`; // ten digits, the last one 0
  await drawer.getByLabel('Phone *', { exact: true }).fill(phone);
  await drawer.getByRole('checkbox', { name: 'I agree to Furama Cuisine using my details as described in the privacy policy.' }).check();
  const sent = guest.waitForRequest((r) => r.method() === 'POST' && !!r.headers()['next-action']);
  await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();
  const request = await sent;
  await expect(drawer.locator('.drawer-ref')).toHaveText(/^FC-[0-9A-HJKMNP-TV-Z]{8}$/);
  expect(await heldCovers(date, '19:00')).toBe(56); // two guests: four covers left

  // The same Server Action eight times at once, each from another phone (the dedupe index would refuse a repeat).
  // Through one server the requests barely overlap, so the test holds every INSERT INTO reservations
  // back until five of them, as many as the app's pool has connections (db/client.ts), are inside their
  // transactions: then only the booking-day lock stands between them and five readings of "four covers left".
  const body = request.postData()!;
  expect(body).toContain(phone);
  const gate = db();
  await gate.connect();
  await gate.query('BEGIN');
  await gate.query('LOCK TABLE reservations IN SHARE MODE');
  const replies = Promise.all(
    Array.from({ length: 8 }, async (_, i) => {
      const res = await guest.request.post(new URL(request.url()).pathname, {
        headers: {
          'next-action': request.headers()['next-action'],
          'content-type': request.headers()['content-type'],
          accept: 'text/x-component',
        },
        data: body.replace(phone, `${phone.slice(0, -1)}${i + 1}`),
      });
      return res.text();
    }),
  );
  try {
    // The app's pool has five connections (db/client.ts): five requests are in their transactions, the
    // other three wait for a connection. Five lock waiters: one at its INSERT and four at the
    // booking-day lock (without that lock, all five at the INSERT, each having read "four left").
    await expect
      .poll(
        // This database's waiters only: tests on another database of the same Postgres (the integration
        // suite, another checkout's E2E) must not fill the count.
        async () =>
          (await one<{ n: number }>(
            `SELECT count(*)::int AS n FROM pg_locks
              WHERE NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
          ))!.n,
        { timeout: 4000 },
      )
      .toBeGreaterThanOrEqual(5);
  } finally {
    await gate.query('COMMIT');
    await gate.end();
  }
  const answers = await replies;
  expect(answers.filter((a) => a.includes('"ok":true'))).toHaveLength(2);
  expect(answers.filter((a) => a.includes('"code":"full"'))).toHaveLength(6);
  expect(await heldCovers(date, '19:00')).toBe(60);
  await guest.context().close();
});

test('A2. a day closed in the admin is greyed out for guests, with its public reason', async ({ page, browser }) => {
  const date = venueDay(13);
  const note = `E2E A2 ${Date.now().toString(36)}`;
  try {
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/reservations/closures');
    await expectHydrated(page);
    const add = page.getByRole('form', { name: 'Thêm ngày đóng cửa' });
    await add.getByLabel('Phạm vi', { exact: true }).selectOption('restaurant');
    await add.getByLabel('Nhà hàng', { exact: true }).selectOption(YUM);
    await add.getByLabel('Từ ngày', { exact: true }).fill(date);
    await add.getByLabel('Đến ngày', { exact: true }).fill(date);
    await add.getByLabel('Lý do cho khách (EN)', { exact: true }).fill('Closed for a private banquet');
    await add.getByLabel('Ghi chú nội bộ (khách không thấy)', { exact: true }).fill(note);
    await add.getByRole('button', { name: 'Thêm ngày đóng cửa' }).click();
    await expect(add.getByRole('status')).toHaveText('Đã thêm ngày đóng cửa.');

    const guest = await guestPage(browser);
    const { drawer, day } = await openYum(guest, 13);
    await expect(day).toHaveAttribute('data-state', 'closed');
    await expect(day).toHaveAttribute('aria-disabled', 'true');
    await expect(day).toHaveAttribute('aria-label', `${formatDay(date).label}: Closed for a private banquet`);
    await expect(day.locator('.day-num')).toHaveCSS('text-decoration-line', 'line-through');
    // A tap says why, and selects nothing.
    await day.click({ force: true });
    await expect(day).toHaveAttribute('aria-pressed', 'false');
    // The drawer keeps its status regions mounted while empty: the one that says something.
    await expect(drawer.getByRole('status').filter({ hasText: /\S/ })).toHaveText(`${formatDay(date).label}: Closed for a private banquet`);
    await guest.context().close();
  } finally {
    await one(`DELETE FROM closures WHERE internal_note = $1`, [note]);
  }
});

test('A3. confirm, cancel and no-show work, each when it may and with what it needs', async ({ page }) => {
  const date = venueDay(12);
  const request = await seedReservation({ restaurant: YUM, date, time: '20:00' });
  const toCancel = await seedReservation({ restaurant: YUM, date, time: '20:30', status: 'confirmed' });
  const future = await seedReservation({ restaurant: YUM, date, time: '21:00', status: 'confirmed' });
  const past = await seedReservation({ restaurant: YUM, date: venueDay(-1), time: '19:00', status: 'confirmed' });
  await signInAs(page, STAFF.editor);
  const main = page.getByRole('main');

  await page.goto(`/admin/reservations/${request.id}`);
  await main.getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Đã xác nhận');
  expect(await reservationRow(request.id)).toMatchObject({ status: 'confirmed', version: 2 });

  await page.goto(`/admin/reservations/${toCancel.id}`);
  await main.getByRole('button', { name: 'Hủy', exact: true }).click();
  await expect(main.getByText('Nhập lý do.')).toBeVisible();
  await page.getByLabel('Lý do (bắt buộc khi hủy hoặc từ chối)', { exact: true }).fill('Khách đổi kế hoạch');
  await main.getByRole('button', { name: 'Hủy', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Đã hủy');
  expect(await reservationRow(toCancel.id)).toMatchObject({ status: 'cancelled', status_reason: 'Khách đổi kế hoạch' });

  // Twelve days out, no-show cannot be marked yet; it opens 15 minutes after the sitting.
  await page.goto(`/admin/reservations/${future.id}`);
  await expect(main.getByRole('button', { name: 'Không đến', exact: true })).toBeDisabled();
  await expect(main.getByText(/^Từ 21:15 ngày /)).toBeVisible();

  await page.goto(`/admin/reservations/${past.id}`);
  await main.getByRole('button', { name: 'Không đến', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Không đến');
  expect((await reservationRow(past.id)).status).toBe('no_show');
  // Every change is on the booking's timeline, not in audit_log (spec §7.4).
  expect(await one(`SELECT count(*)::int AS n FROM reservation_events WHERE reservation_id = ANY ($1::bigint[]) AND type = 'status_changed'`, [[request.id, toCancel.id, past.id]])).toEqual({
    n: 3,
  });
  expect(
    await one(`SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'reservation' AND entity_id = ANY ($1::text[])`, [
      [request.id, toCancel.id, past.id],
    ]),
  ).toEqual({ n: 0 });
});

test('A4. an Editor moves the last dinner seating to 22:00 with 10 covers; the guest, who saw 21:00 last, sees the new slots at once', async ({ page, browser }) => {
  try {
    const guest = await guestPage(browser);
    const before = await openYum(guest, 3);
    await before.day.click();
    await expect(before.drawer.getByRole('button', { name: '21:00 — 60 covers left' })).toBeVisible();
    await expect(before.drawer.getByRole('button', { name: /^22:00/ })).toHaveCount(0);

    await signInAs(page, STAFF.editor);
    await page.goto(`/admin/restaurants/${YUM}/booking?ngay=${venueDay(3)}`);
    await expectHydrated(page);
    const periods = page.getByRole('form', { name: 'Ca phục vụ' });
    await periods.getByLabel('Giờ cuối của ca Dinner', { exact: true }).fill('22:00');
    await periods.getByLabel('Sức chứa của ca Dinner', { exact: true }).fill('10');
    await periods.getByRole('button', { name: 'Lưu ca phục vụ' }).click();
    await expect(periods.getByRole('status')).toHaveText('Đã lưu ca phục vụ.');
    await expect(page.getByLabel('Giờ đặt trong ngày', { exact: true }).getByText('22:00 · 10/10')).toBeVisible();

    const after = await openYum(guest, 3);
    await after.day.click();
    await expect(after.drawer.getByRole('button', { name: '22:00 — 10 covers left' })).toBeVisible();
    await expect(after.drawer.getByRole('button', { name: '21:00 — 10 covers left' })).toBeVisible();
    await guest.context().close();
  } finally {
    await one(SEED_DINNER);
    await one(CLEAR_AUDIT);
  }
});

test('A5. max_party = 8 makes the guest form stop at 8 and turn a ninth guest into a phone call', async ({ page, browser }) => {
  try {
    await signInAs(page, STAFF.editor);
    await page.goto(`/admin/restaurants/${YUM}/booking`);
    await expectHydrated(page);
    const rules = page.getByRole('form', { name: 'Quy tắc đặt bàn' });
    await rules.getByLabel('Số khách tối đa', { exact: true }).fill('8');
    await rules.getByRole('button', { name: 'Lưu quy tắc' }).click();
    await expect(page.getByRole('form', { name: 'Quy tắc đặt bàn' }).getByRole('status')).toHaveText('Đã lưu.');

    const guest = await guestPage(browser);
    const { drawer } = await openYum(guest, 0);
    const more = drawer.getByRole('button', { name: 'More guests' });
    for (let i = 2; i < 8; i++) await more.click();
    await expect(drawer.locator('.guests-value')).toHaveText('8 guests');
    await expect(more).toBeDisabled();
    // The MM Supercenter has no number of its own: the first destination that has one.
    await expect(drawer.locator('.guests-hint')).toHaveText('For more than 8 guests, please call us on +84 236 651 9999.');
    await expect(drawer.locator('.guests-hint a')).toHaveAttribute('href', 'tel:+842366519999');
    await guest.context().close();
  } finally {
    await one(`UPDATE restaurants SET max_party = NULL WHERE id = $1`, [YUM]);
    await one(CLEAR_AUDIT);
  }
});

test('A6. the bookings shorter hours leave out are listed, and none is cancelled until staff choose', async ({ page }) => {
  const date = venueDay(4);
  const late = await seedReservation({ restaurant: YUM, date, time: '21:00' });
  const fine = await seedReservation({ restaurant: YUM, date, time: '19:00', status: 'confirmed' });
  try {
    await signInAs(page, STAFF.editor);
    await page.goto(`/admin/restaurants/${YUM}/booking`);
    await expectHydrated(page);
    const periods = page.getByRole('form', { name: 'Ca phục vụ' });
    await periods.getByLabel('Giờ cuối của ca Dinner', { exact: true }).fill('20:00');
    await periods.getByRole('button', { name: 'Lưu ca phục vụ' }).click();
    await expect(periods.getByRole('status')).toHaveText('Đã lưu ca phục vụ.');

    const list = page.getByRole('form', { name: 'Đặt bàn sắp tới không còn khớp giờ hoặc sức chứa' });
    await expect(list.getByRole('row').filter({ hasText: late.reference })).toContainText('Ngoài giờ phục vụ mới');
    await expect(list.getByRole('row').filter({ hasText: fine.reference })).toHaveCount(0);
    expect((await reservationRow(late.id)).status).toBe('requested');
    expect((await reservationRow(fine.id)).status).toBe('confirmed');
  } finally {
    await one(SEED_DINNER);
    await one(CLEAR_AUDIT);
  }
});
