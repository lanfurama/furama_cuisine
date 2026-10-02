import { randomBytes } from 'node:crypto';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/* /admin/audit (spec §7.2, §7.4): Admin only, newest first, in Vietnamese, booking events included, keyset pages. */

test.beforeAll(() => seedStaff());

test('the Admin reads a role change, with who did it and when', async ({ page }) => {
  const entity = `e2e-audit-${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  await one(
    `INSERT INTO audit_log (actor_id, actor_email, action, entity_type, entity_id, before, after)
     VALUES ($1, $2, 'staff.role', 'staff_user', $3, '{"role":"editor"}', '{"role":"admin"}')`,
    [STAFF.admin.id, STAFF.admin.email, entity],
  );
  await signInAs(page, STAFF.admin);
  await page.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link', { name: 'Nhật ký' }).click();
  await expect(page.getByRole('heading', { name: 'Nhật ký', level: 1 })).toBeVisible();

  const row = page.getByRole('row').filter({ hasText: entity });
  await expect(row.getByRole('cell').nth(0)).toHaveText(/^\d{2}:\d{2} \d{2}\/\d{2}\/\d{4}$/);
  await expect(row.getByRole('cell').nth(1)).toHaveText(STAFF.admin.email);
  await expect(row.getByRole('cell').nth(2)).toHaveText('Đổi vai trò');
  await expect(row.getByRole('cell').nth(3)).toHaveText(`Nhân viên · ${entity}`);
  await row.getByText('Xem').click();
  await expect(row.locator('pre')).toContainText('"role": "admin"');
});

test('a booking event shows the booking’s reference, and an invitation its email', async ({ page }) => {
  const tag = randomBytes(4).toString('hex').toUpperCase().replace(/[ILOU]/g, '7');
  const reference = `FC-E2E${tag.slice(0, 5)}`;
  const booking = await one<{ id: string }>(
    // A past date and a settled status: no booking window or inbox tab of another spec sees it.
    `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, status, source)
     VALUES ($1, 'taya-house', '2025-12-31', '19:00', 'Dinner', 2, 'Khách E2E', '0905000000', '+849050' || $2, 'confirmed', 'web') RETURNING id::text`,
    [reference, String(Date.now()).slice(-5)],
  );
  await one(
    `INSERT INTO reservation_events (reservation_id, actor_kind, actor_id, actor_label, type, from_status, to_status)
     VALUES ($1, 'staff', $2, $3, 'status_changed', 'requested', 'confirmed')`,
    [booking!.id, STAFF.editor.id, `${STAFF.editor.name} (${STAFF.editor.email})`],
  );
  const email = `moi-${tag.toLowerCase()}@furama.test`;
  const invitation = await one<{ id: string }>(
    `INSERT INTO staff_invitation (email, role, token_hash, expires_at) VALUES ($1, 'editor', $2, now() + interval '7 days') RETURNING id::text`,
    [email, randomBytes(32).toString('hex')],
  );
  await one(`INSERT INTO audit_log (actor_email, action, entity_type, entity_id) VALUES ($1, 'staff.invite', 'staff_invitation', $2)`, [
    STAFF.admin.email,
    invitation!.id,
  ]);
  await signInAs(page, STAFF.admin);
  await page.goto('/admin/audit');
  const event = page.getByRole('row').filter({ hasText: reference });
  await expect(event.getByRole('cell').nth(1)).toHaveText(`${STAFF.editor.name} (${STAFF.editor.email})`);
  await expect(event.getByRole('cell').nth(2)).toHaveText('Đổi trạng thái đặt bàn');
  await expect(event.getByRole('cell').nth(3)).toHaveText(`Đặt bàn · ${reference}`);
  await expect(page.getByRole('row').filter({ hasText: email }).getByRole('cell').nth(3)).toHaveText(`Lời mời · ${email}`);
});

test('the Admin pages back and forth through older entries', async ({ page }) => {
  const tag = `e2e-page-${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  // Sixty entries from 2001, older than anything else in the log (the pages read below hold only these),
  // and one from now, so the newest page is never the 2001 one.
  await one(
    `INSERT INTO audit_log (at, actor_email, action, entity_type, entity_id)
     SELECT timestamptz '2001-01-01 00:00:00+00' + g * interval '1 second', $1, 'update', 'restaurant', $2 || '-' || lpad(g::text, 2, '0')
       FROM generate_series(1, 60) AS g
     UNION ALL SELECT now(), $1, 'update', 'restaurant', $2 || '-now'`,
    [STAFF.admin.email, tag],
  );
  try {
    await signInAs(page, STAFF.admin);
    // A cursor just after the newest of them (00:01:00 → 00:01:01, in microseconds since the epoch).
    await page.goto(`/admin/audit?truoc=${Date.UTC(2001, 0, 1, 0, 1, 1) * 1000}_audit_0`);
    const pager = page.getByRole('navigation', { name: 'Phân trang' });
    const ours = page.getByRole('row').filter({ hasText: tag });
    await expect(ours).toHaveCount(50);
    await expect(ours.first().getByRole('cell').nth(3)).toHaveText(`restaurant · ${tag}-60`);
    await expect(ours.last().getByRole('cell').nth(3)).toHaveText(`restaurant · ${tag}-11`);

    await pager.getByRole('link', { name: 'Cũ hơn →' }).click();
    await expect(ours).toHaveCount(10);
    await expect(ours.first().getByRole('cell').nth(3)).toHaveText(`restaurant · ${tag}-10`);
    await expect(pager.getByRole('link', { name: 'Cũ hơn →' })).toHaveCount(0);

    await pager.getByRole('link', { name: '← Mới hơn' }).click();
    await expect(ours).toHaveCount(50);
    await expect(ours.first().getByRole('cell').nth(3)).toHaveText(`restaurant · ${tag}-60`);
    await pager.getByRole('link', { name: 'Mới nhất' }).click();
    await expect(page).toHaveURL(/\/admin\/audit$/);
    await expect(page.getByRole('row').filter({ hasText: `${tag}-now` })).toBeVisible();
    await expect(pager.getByRole('link', { name: '← Mới hơn' })).toHaveCount(0);

    // A page link from phase 3 (?trang=) lands on the newest page.
    await page.goto('/admin/audit?trang=2');
    await expect(page.getByRole('heading', { name: 'Nhật ký', level: 1 })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: `${tag}-now` })).toBeVisible();
    await expect(pager.getByRole('link', { name: 'Mới nhất' })).toHaveCount(0);
  } finally {
    await one(`DELETE FROM audit_log WHERE entity_id LIKE $1`, [`${tag}-%`]);
  }
});

test('an Editor gets the 403 view and no audit rows', async ({ page }) => {
  await signInAs(page, STAFF.editor);
  await expect(page.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link', { name: 'Nhật ký' })).toHaveCount(0);
  const res = await page.goto('/admin/audit');
  expect(await res?.text()).not.toContain(STAFF.admin.email);
  await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
});
