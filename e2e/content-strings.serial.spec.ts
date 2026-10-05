import type { Browser, Page } from '@playwright/test';
import { REGISTRY } from '../lib/i18n/registry';
import { HOME_PATH } from './paths';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * Phase 7 acceptance, strings half (spec §14.1 row 7): text edited in English
 * in the admin shows on the guest site within seconds. Two delivery paths:
 * stories.* is read by the home page on the server and handed to its section
 * (content:ui), search.* reaches the browser through the SiteProvider (the
 * layout's strings, content:ui). Also §7.4's refusal of a value whose ICU
 * variables differ.
 *
 * Serial (desktop-serial): each test changes what every guest page shows and
 * puts the registry default back through the same form (R21), which expires
 * the same tags.
 */

const DEFAULT_TITLE = REGISTRY['stories.title'].en;
const DEFAULT_POPULAR = REGISTRY['search.popular'].en;

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
