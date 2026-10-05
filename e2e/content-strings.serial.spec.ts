import type { Browser, Page } from '@playwright/test';
import { REGISTRY } from '../lib/i18n/registry';
import { expectHydrated } from './csp';
import { HOME_PATH } from './paths';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * Phase 7 acceptance, strings half (spec §14.1 row 7): text edited in English
 * in the admin shows on the guest site within seconds. Two delivery paths:
 * stories.* is read by the home page on the server and handed to its section
 * (content:ui), search.* reaches the browser through the SiteProvider (the
 * layout's strings, content:ui). Also History's restore of one key (§7.5),
 * §7.4's refusal of a value whose ICU variables differ, the policy version a
 * legal edit adds, and the email preview.
 *
 * Serial (desktop-serial): each test changes what every guest page shows and
 * puts the registry default back through the same form (R21), which expires
 * the same tags.
 */

const DEFAULT_TITLE = REGISTRY['stories.title'].en;
const DEFAULT_LEDE = REGISTRY['stories.lede'].en;
const DEFAULT_POPULAR = REGISTRY['search.popular'].en;
const DEFAULT_KEEP = REGISTRY['legal.keep_body'].en;

async function guest(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  return context.newPage();
}

async function saveField(page: Page, path: string, form: string, label: string, value: string, button: string) {
  await page.goto(path);
  const f = page.getByRole('form', { name: form });
  await f.getByLabel(label, { exact: true }).fill(value);
  await f.getByRole('button', { name: button }).click();
  return f;
}

test.beforeAll(() => seedStaff());

test('an editor renames the Stories title: the home page shows it on the next load, and the default comes back', async ({ page, browser }) => {
  const visitor = await guest(browser);
  const heading = visitor.getByRole('heading', { level: 2, name: /Stories|Kitchen/ });
  try {
    await visitor.goto(HOME_PATH);
    await expect(heading).toHaveText(DEFAULT_TITLE);
    await signInAs(page, STAFF.editor);
    try {
      const form = await saveField(page, '/admin/content/stories', 'Stories', 'Tiêu đề mục Stories', 'Kitchen Stories E2E', 'Lưu stories');
      await expect(form.getByRole('status')).toContainText('Đã lưu 1 mục');
      const started = Date.now();
      await visitor.reload();
      await expect(heading).toHaveText('Kitchen Stories E2E');
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      const form = await saveField(page, '/admin/content/stories', 'Stories', 'Tiêu đề mục Stories', DEFAULT_TITLE, 'Lưu stories');
      await expect(form.getByRole('status')).toContainText('Đã lưu 1 mục');
    }
    await visitor.reload();
    await expect(heading).toHaveText(DEFAULT_TITLE);
    expect(await one(`SELECT 1 FROM content_strings WHERE key = 'stories.title'`)).toBeUndefined();
  } finally {
    await visitor.context().close();
  }
});

test('History undoes an edit of the Stories title: the newest row brings the default back, for the guest too', async ({ page, browser }) => {
  const visitor = await guest(browser);
  const heading = visitor.getByRole('heading', { level: 2, name: /Stories|Kitchen/ });
  try {
    await signInAs(page, STAFF.editor);
    try {
      const form = await saveField(page, '/admin/content/stories', 'Stories', 'Tiêu đề mục Stories', 'Kitchen Stories History', 'Lưu stories');
      await expect(form.getByRole('status')).toContainText('Đã lưu 1 mục');
      await visitor.goto(HOME_PATH);
      await expect(heading).toHaveText('Kitchen Stories History');

      const newest = page.getByRole('region', { name: 'Lịch sử' }).getByRole('listitem').first();
      await expect(newest).toContainText('Tiêu đề mục Stories');
      await expect(newest).toContainText(`${DEFAULT_TITLE} → Kitchen Stories History`);
      page.once('dialog', (d) => void d.accept());
      await newest.getByRole('button', { name: /^Khôi phục bản trước lần này/ }).click();
      await expect(page.getByRole('form', { name: 'Stories' }).getByLabel('Tiêu đề mục Stories', { exact: true })).toHaveValue(DEFAULT_TITLE);
      const started = Date.now();
      await visitor.reload();
      await expect(heading).toHaveText(DEFAULT_TITLE);
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(await one(`SELECT 1 FROM content_strings WHERE key = 'stories.title'`)).toBeUndefined();
      await expect(page.getByRole('region', { name: 'Lịch sử' }).getByRole('listitem').first()).toContainText('Khôi phục');
    } finally {
      if (await one(`SELECT 1 FROM content_strings WHERE key = 'stories.title'`)) {
        await saveField(page, '/admin/content/stories', 'Stories', 'Tiêu đề mục Stories', DEFAULT_TITLE, 'Lưu stories');
      }
    }
  } finally {
    await visitor.context().close();
  }
});

test('a History restore of one key keeps what is typed in another (UX-3): the form says it is behind, and saving writes only the typed key', async ({ page }) => {
  const form = page.getByRole('form', { name: 'Stories' });
  const title = form.getByLabel('Tiêu đề mục Stories', { exact: true });
  const lede = form.getByLabel('Câu dẫn mục Stories', { exact: true });
  const typed = 'Chefs and the cultures behind every plate (typed, unsaved).';
  try {
    await signInAs(page, STAFF.editor);
    await saveField(page, '/admin/content/stories', 'Stories', 'Tiêu đề mục Stories', 'Kitchen Stories Stale', 'Lưu stories');
    await expect(form.getByRole('status').filter({ hasText: 'Đã lưu 1 mục' })).toBeVisible();
    await lede.fill(typed);

    // Restore the title from History: the page refreshes with the key's new token.
    const newest = page.getByRole('region', { name: 'Lịch sử' }).getByRole('listitem').first();
    await expect(newest).toContainText(`${DEFAULT_TITLE} → Kitchen Stories Stale`);
    page.once('dialog', (d) => void d.accept());
    await newest.getByRole('button', { name: /^Khôi phục bản trước lần này/ }).click();
    await expect(page.getByRole('region', { name: 'Lịch sử' }).getByRole('listitem').first()).toContainText('Khôi phục');
    await expect(lede).toHaveValue(typed);
    await expect(form.getByRole('status').filter({ hasText: 'Có người vừa lưu bản mới của mục này' })).toBeVisible();

    // Saving writes the typed lede and leaves the restored title alone.
    await form.getByRole('button', { name: 'Lưu stories' }).click();
    await expect(form.getByRole('status').filter({ hasText: 'Đã lưu 1 mục' })).toBeVisible();
    await expect(title).toHaveValue(DEFAULT_TITLE);
    await expect(lede).toHaveValue(typed);
    expect(await one(`SELECT 1 FROM content_strings WHERE key = 'stories.title'`)).toBeUndefined();
    expect(await one(`SELECT value FROM content_strings WHERE key = 'stories.lede'`)).toEqual({ value: typed });
  } finally {
    await page.goto('/admin/content/stories');
    await title.fill(DEFAULT_TITLE);
    await lede.fill(DEFAULT_LEDE);
    await form.getByRole('button', { name: 'Lưu stories' }).click();
    await expect(form.getByRole('status').filter({ hasText: /Đã lưu|Không có gì thay đổi/ })).toBeVisible();
    expect(await one(`SELECT 1 FROM content_strings WHERE key IN ('stories.title', 'stories.lede')`)).toBeUndefined();
  }
});

test('a broken ICU plural is refused next to its field; a valid label reaches the search dialog', async ({ page, browser }) => {
  const visitor = await guest(browser);
  try {
    await signInAs(page, STAFF.editor);
    const bad = await saveField(page, '/admin/content/ui-text', 'Chữ giao diện', 'Số kết quả (số ít / số nhiều)', '{n} RESULTS', 'Lưu chữ giao diện');
    await expect(bad.getByRole('alert')).toBeVisible();
    const field = bad.getByLabel('Số kết quả (số ít / số nhiều)', { exact: true });
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(field).toHaveValue('{n} RESULTS'); // kept after the refusal
    await expect(bad.getByText(/Thiếu biến \{count\}/)).toBeVisible();
    expect(await one(`SELECT 1 FROM content_strings WHERE key = 'search.results'`)).toBeUndefined();

    try {
      const ok = await saveField(page, '/admin/content/ui-text', 'Chữ giao diện', 'Nhãn “ẩm thực phổ biến”', 'TOP CUISINES E2E', 'Lưu chữ giao diện');
      await expect(ok.getByRole('status')).toContainText('Đã lưu 1 mục');
      await visitor.goto(HOME_PATH);
      await visitor.getByRole('banner').getByRole('button', { name: 'SEARCH', exact: true }).click();
      const search = visitor.getByRole('dialog', { name: 'Search' });
      await expect(search.getByText('TOP CUISINES E2E', { exact: true })).toBeVisible();
      // The ICU plural of the registry default still counts.
      await search.getByRole('textbox').fill('taya');
      await expect(search.getByText(/^1 RESULT$/)).toBeVisible();
    } finally {
      const back = await saveField(page, '/admin/content/ui-text', 'Chữ giao diện', 'Nhãn “ẩm thực phổ biến”', DEFAULT_POPULAR, 'Lưu chữ giao diện');
      await expect(back.getByRole('status')).toContainText('Đã lưu 1 mục');
    }
  } finally {
    await visitor.context().close();
  }
});

test('changing the policy text adds a version: the policy page shows the text and the new date', async ({ page, browser }) => {
  const visitor = await guest(browser);
  const today = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
  try {
    await signInAs(page, STAFF.editor);
    try {
      const form = await saveField(page, '/admin/content/legal', 'Chính sách bảo mật', 'Mục 4: nội dung', 'We keep your booking for 12 months.', 'Lưu chính sách bảo mật');
      await expect(form.getByRole('status')).toContainText('Phiên bản chính sách mới');
      await visitor.goto('/en/privacy');
      await expect(visitor.getByText('We keep your booking for 12 months.')).toBeVisible();
      await expect(visitor.getByText(`Last updated ${today}`)).toBeVisible();
    } finally {
      // The seeded version back first, so restoring the seeded wording adds no version (its hash matches the seed row).
      await one(`DELETE FROM legal_versions WHERE created_by IS DISTINCT FROM 'seed'`);
      await saveField(page, '/admin/content/legal', 'Chính sách bảo mật', 'Mục 4: nội dung', DEFAULT_KEEP, 'Lưu chính sách bảo mật');
      await expect(page.getByRole('form', { name: 'Chính sách bảo mật' }).getByRole('status')).toContainText('Đã lưu 1 mục');
    }
    await visitor.goto('/en/privacy');
    await expect(visitor.getByText('Last updated 3 October 2026')).toBeVisible();
    expect(await one(`SELECT count(*)::int AS n FROM legal_versions`)).toEqual({ n: 1 });
  } finally {
    await visitor.context().close();
  }
});

test('the email screen previews unsaved text with the sample booking, and writes nothing', async ({ page }) => {
  await signInAs(page, STAFF.editor);
  await page.goto('/admin/content/emails');
  const form = page.getByRole('form', { name: 'Nội dung email' });
  await expectHydrated(page);
  // The preview's own choices are not the email's text (UX-8): changing them leaves nothing unsaved.
  await form.getByLabel('Loại email', { exact: true }).selectOption('staff.new');
  await expect(form.getByLabel('Loại email', { exact: true })).toHaveValue('staff.new');
  await expect(form.getByText('Có thay đổi chưa lưu.')).toHaveCount(0);
  await form.getByLabel('Loại email', { exact: true }).selectOption('guest.confirmed');
  await form.getByLabel('email.guest.confirmed.subject', { exact: true }).fill('Table confirmed! {reference}');
  await expect(form.getByText('Có thay đổi chưa lưu.')).toBeVisible();
  // The frame is sandbox="" (no scripts, opaque origin), so the test reads what the server sent into it.
  const preview = (text: RegExp | string) =>
    Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/admin/emails/preview') && r.request().method() === 'POST'),
      form.getByRole('button', { name: 'Xem trước' }).click(),
    ]).then(async ([response]) => {
      const body = await response.text();
      expect(body).toMatch(text);
      return response;
    });
  const shown = await preview('Tiêu đề: <strong>Table confirmed! FC-0000TEST</strong>');
  expect(shown.status()).toBe(200);
  expect(shown.headers()['content-security-policy']).toContain("frame-ancestors 'self'");
  expect(page.frames().some((f) => f.name() === 'email-preview' && f.url().endsWith('/api/admin/emails/preview'))).toBe(true);
  // Typed text is still in the form, and nothing reached the database.
  await expect(form.getByLabel('email.guest.confirmed.subject', { exact: true })).toHaveValue('Table confirmed! {reference}');
  expect(await one(`SELECT 1 FROM content_strings WHERE key LIKE 'email.%'`)).toBeUndefined();

  // A dropped variable is refused in the preview too.
  await form.getByLabel('email.guest.confirmed.subject', { exact: true }).fill('Table confirmed!');
  const refused = await preview(/Thiếu biến \{reference\}/);
  expect(refused.status()).toBe(422);
});
