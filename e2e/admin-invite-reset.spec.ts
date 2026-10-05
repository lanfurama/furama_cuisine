import { createHash, randomBytes } from 'node:crypto';
import { expectHydrated, watchCsp } from './csp';
import { emailsTo, nextLink } from './email-log';
import { db, expect, formAlert, newVisitor, seedStaff, signIn, test } from './staff-fixtures';

/*
 * The two public flows of spec §7.1/§7.2: accepting an invitation (the token
 * is the credential) and resetting a forgotten password through an emailed
 * link. Each test makes its own accounts and invitations, so files and reruns
 * never share one.
 */

const unique = () => `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;

/** An invitation written by SQL with a token the test knows; returns its accept URL path. */
async function invitation(email: string, opts: { expired?: boolean; revoked?: boolean } = {}): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const client = db();
  await client.connect();
  try {
    await client.query(
      `INSERT INTO staff_invitation (email, role, token_hash, expires_at, revoked_at)
       VALUES ($1, 'editor', $2, now() + $3::interval, $4)`,
      [email, createHash('sha256').update(token).digest('hex'), opts.expired ? '-1 minute' : '7 days', opts.revoked ? new Date() : null],
    );
  } finally {
    await client.end();
  }
  return `/admin/accept-invite?token=${token}`;
}

const INVALID = 'Lời mời không hợp lệ, đã hết hạn hoặc đã bị thu hồi. Hãy nhờ Admin gửi lại lời mời.';

test.describe('accepting an invitation', () => {
  test('the invitee sets a name and password, is signed in as Editor, and the link is single-use', async ({ page, browser }, testInfo) => {
    const email = `invitee-${unique()}@furama.test`;
    const link = await invitation(email);
    const violations = await watchCsp(page);
    await page.goto(link);
    await expectHydrated(page);
    await expect(page.getByText(email)).toBeVisible();
    await page.getByLabel('Họ tên', { exact: true }).fill('Lê Thị An');
    await page.getByLabel('Mật khẩu (12–128 ký tự)', { exact: true }).fill('an passphrase 2026');
    await page.getByRole('button', { name: 'Tạo tài khoản' }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByTestId('staff-name')).toHaveText('Lê Thị An');
    await expect(page.getByText(`${email} · Editor`)).toBeVisible();
    expect(violations).toEqual([]);

    const again = await newVisitor(browser, testInfo);
    await again.goto(link);
    await expect(again.getByRole('main').getByRole('alert')).toHaveText(INVALID);
    await expect(again.getByRole('button', { name: 'Tạo tài khoản' })).toHaveCount(0);
  });

  test('an expired or revoked invitation shows the invalid view', async ({ page }) => {
    for (const opts of [{ expired: true }, { revoked: true }]) {
      await page.goto(await invitation(`invitee-${unique()}@furama.test`, opts));
      await expect(page.getByRole('main').getByRole('alert')).toHaveText(INVALID);
    }
    await page.goto('/admin/accept-invite?token=not-a-token');
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(INVALID);
  });

  test('a short password is refused in Vietnamese, what was typed stays, and nothing is created', async ({ page }) => {
    const email = `invitee-${unique()}@furama.test`;
    await page.goto(await invitation(email));
    await page.getByLabel('Họ tên', { exact: true }).fill('Ngắn');
    await page.getByLabel('Mật khẩu (12–128 ký tự)', { exact: true }).fill('ngan qua');
    await page.getByRole('button', { name: 'Tạo tài khoản' }).click();
    await expect(page.locator('form').getByText('Mật khẩu cần ít nhất 12 ký tự.')).toBeVisible();
    // What was typed stays (phase-3 ledger: the form used to clear while saying the input was kept).
    await expect(page.getByLabel('Họ tên', { exact: true })).toHaveValue('Ngắn');
    await expect(page.getByLabel('Mật khẩu (12–128 ký tự)', { exact: true })).toHaveValue('ngan qua');
    await expect(page).toHaveURL(/\/admin\/accept-invite\?token=/);
    const client = db();
    await client.connect();
    try {
      expect((await client.query('SELECT 1 FROM staff_user WHERE email = $1', [email])).rowCount).toBe(0);
    } finally {
      await client.end();
    }
  });
});

test.describe('resetting a forgotten password', () => {
  test('request → emailed link → new password; the old one stops working', async ({ page }) => {
    const id = unique();
    const member = { id: `e2e-reset-${id}`, name: 'Quên Mật Khẩu', email: `reset-${id}@furama.test`, password: 'old passphrase 2026', role: 'editor', banned: false } as const;
    await seedStaff([member]);

    await page.goto('/admin/sign-in');
    await page.getByRole('link', { name: 'Quên mật khẩu?' }).click();
    await expect(page).toHaveURL(/\/admin\/reset-password$/);
    // The sign-in page stays mounted but hidden (Activity); role queries skip hidden nodes.
    await page.getByRole('textbox', { name: 'Email' }).fill(member.email);
    await page.getByRole('button', { name: 'Gửi liên kết' }).click();
    await expect(page.getByRole('main').getByRole('status')).toHaveText(
      'Nếu email này có tài khoản, chúng tôi đã gửi liên kết đặt lại mật khẩu. Liên kết có hiệu lực trong 60 phút.',
    );

    const link = await nextLink(member.email, '/admin/reset-password');
    await page.goto(link);
    await page.getByLabel('Mật khẩu mới (12–128 ký tự)', { exact: true }).fill('new passphrase 2026');
    await page.getByRole('button', { name: 'Đặt mật khẩu' }).click();
    await expect(page.getByRole('main').getByRole('status')).toHaveText('Đã đổi mật khẩu. Hãy đăng nhập bằng mật khẩu mới.');

    await page.getByRole('link', { name: 'Đăng nhập' }).click();
    await expect(page).toHaveURL(/\/admin\/sign-in$/);
    await signIn(page, member.email, member.password);
    await expect(formAlert(page)).toHaveText('Email hoặc mật khẩu không đúng.');
    await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeEnabled();
    await signIn(page, member.email, 'new passphrase 2026');
    await expect(page).toHaveURL(/\/admin$/);

    // The link worked once.
    await page.goto(link);
    await page.getByLabel('Mật khẩu mới (12–128 ký tự)', { exact: true }).fill('another passphrase 2026');
    await page.getByRole('button', { name: 'Đặt mật khẩu' }).click();
    await expect(formAlert(page).getByRole('paragraph')).toHaveText('Liên kết không hợp lệ hoặc đã được dùng. Hãy yêu cầu một liên kết mới.');
    // With the way out (phase-3 ledger): the request form, without the used token.
    await expect(formAlert(page).getByRole('link', { name: 'Gửi lại liên kết đặt lại mật khẩu' })).toHaveAttribute('href', '/admin/reset-password');
  });

  test('an unknown email gets the same answer, and no email is sent', async ({ page }) => {
    const email = `nobody-${unique()}@furama.test`;
    await page.goto('/admin/reset-password');
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByRole('button', { name: 'Gửi liên kết' }).click();
    await expect(page.getByRole('main').getByRole('status')).toHaveText(
      'Nếu email này có tài khoản, chúng tôi đã gửi liên kết đặt lại mật khẩu. Liên kết có hiệu lực trong 60 phút.',
    );
    await page.waitForTimeout(500);
    expect(emailsTo(email)).toEqual([]);
  });
});
