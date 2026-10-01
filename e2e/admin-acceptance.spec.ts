import { randomBytes } from 'node:crypto';
import type { Page, Request } from '@playwright/test';
import { nextLink } from './email-log';
import { STAFF, expect, newVisitor, one, seedStaff, signIn, signInAs, test, withAdminCountLock } from './staff-fixtures';

/*
 * Phase 3 acceptance (spec §14.1, row 3), end to end through the UI:
 * 1. invite → accept → sign in;
 * 2. a role change writes exactly one audit row, with the right actor;
 * 3. the Editor is kept out of the Admin area: no link, no page, and a
 *    replayed Admin-only Server Action is refused with nothing written;
 * 4. a browser call to /api/auth/admin/* is rejected, even for an Admin.
 * Serial: each test builds on the one before.
 */
test.describe.configure({ mode: 'serial' });

test.beforeAll(() => seedStaff());

const invitee = {
  email: `accept-${Date.now().toString(36)}${randomBytes(2).toString('hex')}@furama.test`,
  name: 'Nhân Viên Mới',
  password: 'new staff passphrase',
};
let inviteeId: string;
let roleAction: Request;

/** Audit rows about the invitee or by them (other workers write rows of their own meanwhile). */
const auditCount = async () =>
  (await one<{ n: number }>('SELECT count(*)::int AS n FROM audit_log WHERE entity_id = $1 OR actor_id = $1', [inviteeId]))!.n;
const roleOf = async (id: string) => (await one<{ role: string }>('SELECT role FROM staff_user WHERE id = $1', [id]))?.role;

async function openUsers(page: Page) {
  await signInAs(page, STAFF.admin);
  await page.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link', { name: 'Nhân viên' }).click();
  await expect(page.getByRole('heading', { name: 'Nhân viên', level: 1 })).toBeVisible();
}

test('1. invite → accept → sign in', async ({ page, browser }, testInfo) => {
  await openUsers(page);
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(invitee.email);
  await page.getByRole('combobox', { name: 'Vai trò', exact: true }).selectOption('editor');
  await page.getByRole('button', { name: 'Gửi lời mời' }).click();
  await expect(page.getByRole('main').getByRole('status')).toHaveText('Đã gửi lời mời.');

  const link = await nextLink(invitee.email, '/admin/accept-invite');
  const newcomer = await newVisitor(browser, testInfo);
  await newcomer.goto(link);
  await newcomer.getByLabel('Họ tên', { exact: true }).fill(invitee.name);
  await newcomer.getByLabel('Mật khẩu (12–128 ký tự)', { exact: true }).fill(invitee.password);
  await newcomer.getByRole('button', { name: 'Tạo tài khoản' }).click();
  await expect(newcomer).toHaveURL(/\/admin$/);
  await expect(newcomer.getByTestId('staff-name')).toHaveText(invitee.name);
  await expect(newcomer.getByText(`${invitee.email} · Editor`)).toBeVisible();

  // Signed out and back in with the password just chosen.
  await newcomer.getByRole('button', { name: 'Đăng xuất' }).click();
  await expect(newcomer).toHaveURL(/\/admin\/sign-in$/);
  await signIn(newcomer, invitee.email, invitee.password);
  await expect(newcomer).toHaveURL(/\/admin$/);

  inviteeId = (await one<{ id: string }>('SELECT id FROM staff_user WHERE email = $1', [invitee.email]))!.id;
  expect(await one('SELECT used_at IS NOT NULL AS used FROM staff_invitation WHERE email = $1', [invitee.email])).toEqual({ used: true });
});

test('2. a role change writes exactly one audit row, with the acting Admin', async ({ page }) => {
  await openUsers(page);
  const select = page.getByRole('row').filter({ hasText: invitee.email }).getByRole('combobox');
  await withAdminCountLock(async () => {
    const before = await auditCount();
    const actionRequest = page.waitForRequest((r) => r.method() === 'POST' && !!r.headers()['next-action']);
    // A role change asks first (StaffTable); with no listener Playwright would dismiss it.
    page.once('dialog', (dialog) => dialog.accept());
    await select.selectOption('admin');
    roleAction = await actionRequest;
    await expect.poll(() => roleOf(inviteeId)).toBe('admin');
    expect(await auditCount()).toBe(before + 1);
    const rows = await one<{ rows: unknown[] }>(
      `SELECT json_agg(json_build_object('actor_id', actor_id, 'actor_email', actor_email, 'action', action,
                                         'entity_id', entity_id, 'before', before, 'after', after)) AS rows
         FROM (SELECT * FROM audit_log WHERE entity_id = $1 ORDER BY id DESC LIMIT 1) last`,
      [inviteeId],
    );
    expect(rows!.rows).toEqual([
      {
        actor_id: STAFF.admin.id,
        actor_email: STAFF.admin.email,
        action: 'staff.role',
        entity_id: inviteeId,
        before: { role: 'editor' },
        after: { role: 'admin' },
      },
    ]);

    // Back to Editor: one more row.
    page.once('dialog', (dialog) => dialog.accept());
    await select.selectOption('editor');
    await expect.poll(() => roleOf(inviteeId)).toBe('editor');
    expect(await auditCount()).toBe(before + 2);
  });
});

test('3. the Editor is kept out of the Admin area, including a direct POST to an Admin-only action', async ({ browser, playwright, baseURL }, testInfo) => {
  const editor = await newVisitor(browser, testInfo);
  await signInAs(editor, invitee);
  await expect(editor.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link')).toHaveText(['Tổng quan']);
  const res = await editor.goto('/admin/users');
  expect(await res?.text()).not.toContain(STAFF.admin.email);
  await expect(editor.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible();

  // The Admin's captured "change role" action, replayed with the Editor's cookie: "make me Admin".
  const before = await auditCount();
  const replay = {
    headers: {
      'next-action': roleAction.headers()['next-action'],
      'content-type': roleAction.headers()['content-type'],
      accept: 'text/x-component',
      origin: baseURL!,
    },
    data: JSON.stringify([inviteeId, 'admin']),
  };
  const path = new URL(roleAction.url()).pathname;
  const asEditor = await editor.request.post(path, replay);
  expect(asEditor.status()).toBe(200);
  expect(await asEditor.text()).toContain('"code":"forbidden"');

  const anonymous = await playwright.request.newContext({ baseURL });
  try {
    // Without a cookie the proxy turns it away before any action runs...
    expect((await anonymous.post(path, { ...replay, maxRedirects: 0 })).status()).toBe(307);
    // ...and with a forged one it reaches requirePermission, which refuses it.
    const forged = await anonymous.post(path, {
      ...replay,
      headers: { ...replay.headers, cookie: 'better-auth.session_token=forged.value' },
    });
    expect(await forged.text()).toContain('"code":"forbidden"');
  } finally {
    await anonymous.dispose();
  }

  expect(await roleOf(inviteeId)).toBe('editor');
  expect(await auditCount()).toBe(before);
});

test('4. a browser call to /api/auth/admin/* is rejected, even for an Admin', async ({ page }) => {
  await signInAs(page, STAFF.admin);
  const results = await page.evaluate(async (userId) => {
    const setRole = await fetch('/api/auth/admin/set-role', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId, role: 'admin' }),
    });
    const listUsers = await fetch('/api/auth/admin/list-users');
    return { setRole: setRole.status, body: await setRole.json(), listUsers: listUsers.status };
  }, inviteeId);
  expect(results).toEqual({ setRole: 403, body: { code: 'ADMIN_ENDPOINT_BLOCKED' }, listUsers: 403 });
  expect(await roleOf(inviteeId)).toBe('editor');
});
